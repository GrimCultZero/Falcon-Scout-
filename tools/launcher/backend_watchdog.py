"""
Launcher watchdog: starts the backend as a child process and restarts ONLY
that child if port :8000 is listening but /health does not answer for
`--fail-threshold` consecutive checks, `--check-interval` seconds apart.

Never touches any other process - it only ever signals the PID it itself
spawned. Logs every start/restart/health-check-failure to logs/backend_watchdog.log.
"""
import argparse
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PY = ROOT / ".venv" / "Scripts" / "python.exe"
RUN_BACKEND = ROOT / "run_backend.py"
LOG_PATH = ROOT / "logs" / "backend_watchdog.log"


def log(msg: str) -> None:
    LOG_PATH.parent.mkdir(exist_ok=True)
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    print(line)


def port_listening(port: int, host: str = "127.0.0.1", timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def health_ok(port: int, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def start_backend(port: int, reload: bool) -> subprocess.Popen:
    args = [str(PY), str(RUN_BACKEND), "--port", str(port)]
    if reload:
        args.append("--reload")
    return subprocess.Popen(args, cwd=str(ROOT))


class Watchdog:
    """Core restart logic, with start/port_listening/health_ok/sleep injectable
    so the decision logic can be unit-tested without spawning real processes."""

    def __init__(self, port, reload, check_interval, fail_threshold,
                 start=start_backend, is_port_listening=port_listening,
                 is_health_ok=health_ok, sleep=time.sleep, logger=log):
        self.port = port
        self.reload = reload
        self.check_interval = check_interval
        self.fail_threshold = fail_threshold
        self._start = start
        self._port_listening = is_port_listening
        self._health_ok = is_health_ok
        self._sleep = sleep
        self._log = logger
        self.consecutive_fails = 0
        self.proc = None

    def start(self):
        self.proc = self._start(self.port, self.reload)
        self.consecutive_fails = 0
        self._log(f"watchdog: started backend pid={self.proc.pid} port={self.port} reload={self.reload}")
        return self.proc

    def tick(self):
        """One check cycle. Returns True if the backend was (re)started this tick."""
        if self.proc.poll() is not None:
            self._log(f"watchdog: backend pid={self.proc.pid} exited with code {self.proc.returncode}; restarting")
            self.start()
            return True

        if not self._port_listening(self.port):
            # still starting up - not a failure
            return False

        if self._health_ok(self.port):
            self.consecutive_fails = 0
            return False

        self.consecutive_fails += 1
        self._log(
            f"watchdog: /health check failed ({self.consecutive_fails}/{self.fail_threshold}) "
            f"while port {self.port} is listening, pid={self.proc.pid}"
        )
        if self.consecutive_fails >= self.fail_threshold:
            self._log(
                f"watchdog: /health unresponsive for {self.fail_threshold} consecutive checks; "
                f"restarting backend pid={self.proc.pid}"
            )
            self._stop(self.proc)
            self.start()
            return True
        return False

    @staticmethod
    def _stop(proc):
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    def run_forever(self):
        self.start()
        try:
            while True:
                self._sleep(self.check_interval)
                self.tick()
        except KeyboardInterrupt:
            self._log("watchdog: KeyboardInterrupt, stopping backend")
            self._stop(self.proc)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--check-interval", type=float, default=10.0)
    parser.add_argument("--fail-threshold", type=int, default=3)
    args = parser.parse_args()

    Watchdog(
        port=args.port,
        reload=args.reload,
        check_interval=args.check_interval,
        fail_threshold=args.fail_threshold,
    ).run_forever()


if __name__ == "__main__":
    main()
