// generate() re-entrancy guard (investigation: job 24303 had two `generations` rows
// 91ms apart, different text, only the second linked to the proposal actually sent).
//
// READ-ONLY FINDINGS (see WORKLOG.md for the full writeup):
//   * _recordGeneration is called exactly ONCE per generate() invocation (the single
//     call site inside generate(), after the full pipeline) -- a double DB row requires
//     the WHOLE async generate() to have run twice, not a retry or a duplicate insert.
//   * None of the three buttons that call generate() directly (Generate Cover Letter,
//     Redo, Rescan & Re-write), nor chat's "Rework letter" (which calls it via onRework),
//     disabled themselves against a generate() already in flight -- Redo/Rescan have no
//     disabled prop tied to loading at all, and Rework letter's disabled={sending} is
//     InlineChat's OWN chat-send state, unrelated to the parent's generate().
//   * The "Generate Cover Letter" button is the likely trigger for THIS incident
//     specifically: its onClick defers the real generate() call via setTimeout(..., 480)
//     (a logo-flash animation), and generate()'s own setLoading(true) -- the only thing
//     that would hide/disable it -- doesn't run until that 480ms timer fires. A fast
//     double-click (human double-clicks commonly land well under 480ms apart) schedules
//     TWO independent generate() calls before either has set loading; each runs its own
//     real Claude call and records its own row, which explains both the different text
//     (two independent model calls, not one draft and a post-processed copy of it) and
//     the close-but-not-identical timestamps (two full pipelines that each took about
//     the same time, started ~91ms apart, so they finished about that far apart too).
//   * Conclusion: ours to fix (a missing re-entrancy guard), not React/StrictMode (a
//     production build has no StrictMode, and StrictMode never double-invokes a click
//     handler either way) and not a network retry (no retry logic exists in this path).
//
// FIX: a ref-based lock (generatingRef, since React's `loading` state can't be read
// synchronously across two near-simultaneous invocations due to render batching) at the
// very top of generate(), before any state mutation -- the second of two near-simultaneous
// calls is dropped before it does anything, including the paid Claude call.
//
// What this file checks:
//   1. the guard is actually wired into JobDetail.jsx, in the right order (static,
//      against the real source -- this project's existing pattern for logic that is not
//      extracted into a standalone lib function; see test_bridge_port.py, bridge-lockdown.test.js);
//   2. the general pattern itself is correct, reproduced standalone and driven with the
//      SAME 91ms gap job 24303 showed -- proof the technique actually suppresses a second
//      near-simultaneous call rather than just asserting the source text is present.
//
// Run: node tests/generate-reentrancy.test.js
const fs = require('fs');
const path = require('path');

let bad = 0;
const assert = (ok, msg) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); };
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'components', 'JobDetail.jsx'), 'utf8');

// ── 1. static: the guard is wired into generate() itself, in the right order ───────
const genStart = src.indexOf('const generate = async (adjustmentsArg, options = {}) => {');
assert(genStart > 0, 'generate() is found');
const guardIdx = src.indexOf('if (generatingRef.current) {', genStart);
const setTrueIdx = src.indexOf('generatingRef.current = true', genStart);
const setLoadingTrueIdx = src.indexOf('setLoading(true)', genStart);
assert(guardIdx > genStart && guardIdx < setLoadingTrueIdx, 'the guard check runs BEFORE setLoading(true) -- before anything else in the call');
assert(setTrueIdx > guardIdx && setTrueIdx < setLoadingTrueIdx, 'generatingRef is set true right after the guard, still before setLoading(true)');
const guardBlock = src.slice(guardIdx, src.indexOf('}', src.indexOf('return', guardIdx)) + 1);
assert(/console\.warn/.test(guardBlock) && /\breturn\b/.test(guardBlock),
  'a call while one is already running logs a warning and returns -- it never reaches the Claude call');

const finallyBlock = src.slice(src.lastIndexOf('} finally {', src.indexOf('generatingRef.current = false')), src.indexOf('generatingRef.current = false') + 40);
assert(/setLoading\(false\)[\s\S]*generatingRef\.current = false/.test(finallyBlock), 'the SAME finally block that clears loading also clears the re-entrancy lock -- every exit path (success, error, stale-navigation) releases it');

assert(/const generatingRef = useRef\(false\)/.test(src), 'generatingRef is declared with the other per-job refs');

// ── 2. the pattern itself, reproduced standalone and driven with job 24303's own timing ──
function makeGuarded(body) {
  const ref = { current: false };
  const calls = [];
  const fn = async (...args) => {
    if (ref.current) { calls.push({ ran: false }); return; }
    ref.current = true;
    try {
      calls.push({ ran: true });
      return await body(...args);
    } finally {
      ref.current = false;
    }
  };
  fn.calls = calls;
  return fn;
}

(async () => {
  // Two "clicks" 91ms apart (job 24303's own gap), each kicking off a ~200ms "Claude call" --
  // long enough that the first is still in flight when the second lands.
  let running = 0, maxConcurrent = 0;
  const slowBody = () => new Promise((resolve) => {
    running++; maxConcurrent = Math.max(maxConcurrent, running);
    setTimeout(() => { running--; resolve('done'); }, 200);
  });
  const guarded = makeGuarded(slowBody);

  const p1 = guarded();
  await new Promise((r) => setTimeout(r, 91));  // job 24303's exact gap
  const p2 = guarded();
  await Promise.all([p1, p2]);

  assert(guarded.calls.length === 2, 'both calls are observed (the guard does not silently swallow the second -- it is counted, just not run)');
  assert(guarded.calls.filter((c) => c.ran).length === 1, 'exactly ONE of the two near-simultaneous calls actually ran the body -- this is the fix for job 24303');
  assert(maxConcurrent === 1, 'the slow body never ran concurrently with itself');

  // Serial calls (one fully finishes before the next starts) are NEVER blocked by the lock.
  const guarded2 = makeGuarded(slowBody);
  await guarded2();
  await guarded2();
  assert(guarded2.calls.every((c) => c.ran), 'two SERIAL calls (first finished before the second starts) both run -- the lock only blocks overlap, never a legitimate re-click after completion');

  console.log(bad ? `\n${bad} FAILURES` : '\nall pass');
  process.exit(bad ? 1 : 0);
})();
