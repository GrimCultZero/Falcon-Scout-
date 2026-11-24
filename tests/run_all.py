# -*- coding: utf-8 -*-
"""Runs every tests/test_*.py. A suite fails on a non-zero exit code OR any output line
starting with "FAIL". Each runs in its own interpreter (-I) so suites cannot affect each other.

Run: python tests/run_all.py   (from the project root, inside .venv)
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
files = sorted(HERE.glob("test_*.py")) + sorted((HERE / "metro").glob("test_*.py"))  # + Metro suites
failed = []
for f in files:
    r = subprocess.run([sys.executable, "-I", str(f)], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=180, cwd=str(HERE.parent))
    out = (r.stdout or "") + (r.stderr or "")
    fail_lines = [l for l in out.splitlines() if l.startswith("FAIL")]
    bad = r.returncode != 0 or bool(fail_lines)
    print(("FAIL" if bad else "ok  ") + "  " + str(f.relative_to(HERE)) + (f"  ({len(fail_lines)} FAIL lines)" if fail_lines else ""))
    if bad:
        failed.append(str(f.relative_to(HERE)))
        for l in fail_lines[:5]:
            print("        " + l)
print(f"\n{len(files)} Python suites, {len(failed)} failing")
sys.exit(1 if failed else 0)
