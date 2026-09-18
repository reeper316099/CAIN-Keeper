"""
Smoke test for a packaged CAIN Keeper build (used by the release workflows).

Usage: python scripts/smoke_test.py <path-to-executable>

Starts the executable on a spare port with a temporary data folder, waits
for it to answer, checks a few pages and API endpoints, then shuts it down.
Exits non-zero if anything fails.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as r:
        return r.read()


def main() -> int:
    exe = sys.argv[1]
    port = free_port()
    data_dir = tempfile.mkdtemp(prefix="cain-keeper-smoke-")
    env = {**os.environ, "CAIN_KEEPER_DATA": data_dir}
    proc = subprocess.Popen([exe, "--port", str(port), "--no-open"], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.time() + 60
        while time.time() < deadline:
            if proc.poll() is not None:
                print(proc.stdout.read())
                print("server exited early"); return 1
            try:
                get(base + "/"); break
            except Exception:
                time.sleep(0.5)
        else:
            proc.kill(); print(proc.stdout.read()); print("server never answered"); return 1

        assert b"CAIN" in get(base + "/"), "home page missing brand"
        lib = json.loads(get(base + "/api/library"))
        assert len(lib["entries"]) == 12, "library not seeded"
        assert b"Category Rating" in get(base + "/cat"), "CAT page broken"
        assert b"Blasphemy Library" in get(base + "/library"), "library page broken"
        assert get(base + "/static/css/style.css").startswith(b"/*"), "static files not bundled"
        req = urllib.request.Request(base + "/api/roll", data=json.dumps({"kind": "pool", "params": {"skill_dice": 3}}).encode(),
                                     headers={"Content-Type": "application/json"})
        roll = json.loads(urllib.request.urlopen(req, timeout=5).read())
        assert roll["kind"] == "pool" and len(roll["dice"]) == 3, "dice roll broken"
        assert os.path.exists(os.path.join(data_dir, "blasphemy_library.json")), "data dir not created"

        # The VERSION file must actually be bundled and readable - this is
        # what a packaged build reports itself as in the in-app update
        # check (updater.py). Only assert the parts that don't depend on
        # this runner's network reaching GitHub (which the background
        # startup check may or may not have finished by now).
        update = json.loads(get(base + "/api/update"))
        assert update["frozen"] is True, "packaged build not reporting itself as frozen"
        assert update["method"] == "download", "packaged build should report the download update method"
        assert update["current"] not in ("", "unknown"), f"VERSION file not bundled correctly: {update['current']!r}"

        print(f"smoke test passed on port {port}, data in {data_dir}")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == "__main__":
    sys.exit(main())
