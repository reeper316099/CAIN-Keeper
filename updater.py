"""
updater.py - checks GitHub for a newer release and reports how to get it,
tailored to how this copy of CAIN Keeper is currently running.

Two install methods, two update paths:
  * Packaged build (the PyInstaller executable from a GitHub Release):
    points at the matching asset on the latest release - specifically the
    same KIND of asset this copy was installed from (see _install_kind()):
    the portable zip if you unzipped one, the platform installer (.exe
    Inno Setup / .dmg / .AppImage - see build-package.yml) if you used one
    of those, since each release now has both per platform.
  * Running from source (a git checkout): can update itself in place with
    a plain `git pull`. An unzipped source tree with no .git just gets
    pointed at the repository to update manually.

Everything here is best-effort and silent on failure. This app is meant
to work fully offline at a table with no wifi, so a failed version check
must never raise, block startup, or nag the user - see check()'s
"checked" field, which callers use to tell "no update" apart from
"couldn't reach GitHub right now."
"""

from __future__ import annotations

import json
import platform
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import storage

REPO = "reeper316099/CAIN-Keeper"
RELEASES_API = f"https://api.github.com/repos/{REPO}/releases/latest"
RELEASES_PAGE = f"https://github.com/{REPO}/releases/latest"

#: Matches a clean "vMAJOR.MINOR.PATCH" tag. Anything else (a dev build's
#: "dev-<sha>", a dirty git tree's "-dirty" suffix, "unknown") is still
#: shown to the user but never asserted as outdated - only a clean pair
#: of versions on both sides gets compared.
_SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


def _semver(tag: str) -> tuple[int, int, int] | None:
    m = _SEMVER_RE.match(tag.strip())
    if not m:
        return None
    a, b, c = m.groups()
    return (int(a), int(b), int(c))


def _bundled_version_file() -> Path:
    """Where a packaged build's own VERSION file lives (written at build
    time - see .github/workflows/build-package.yml - so it's always
    accurate for that exact build, never a committed file someone forgot
    to bump)."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / "VERSION"


def _is_git_checkout() -> bool:
    return (storage.BASE_DIR / ".git").exists()


def get_current_version() -> str:
    """
    The version this running instance reports as.

    Packaged build: the VERSION file baked into the bundle, e.g. "v1.0.4"
    (or "dev-abc1234" for a build made from an untagged commit).
    Running from source: `git describe`, which reports the nearest tag
    plus how many commits ahead and whether the tree has local edits -
    accurate without a file to remember to bump. Falls back to "unknown"
    if this isn't a git checkout or git isn't on PATH.
    """
    if storage.FROZEN:
        try:
            text = _bundled_version_file().read_text(encoding="utf-8").strip()
            return text or "unknown"
        except OSError:
            return "unknown"
    if not _is_git_checkout():
        return "unknown"
    try:
        proc = subprocess.run(
            ["git", "describe", "--tags", "--always", "--dirty"],
            cwd=storage.BASE_DIR, capture_output=True, text=True, timeout=3,
        )
        return proc.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def fetch_latest_release(timeout: float = 4.0) -> dict[str, Any] | None:
    """
    GET the latest GitHub Release. Returns None on ANY failure (offline,
    timeout, rate limit, malformed response) rather than raising -
    callers must treat None as "couldn't check right now," not "no
    update available."
    """
    req = urllib.request.Request(
        RELEASES_API,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "CAIN-Keeper-update-check"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 200:
                return None
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None
    if not isinstance(data, dict):
        return None
    assets = [
        {"name": a.get("name", ""), "url": a.get("browser_download_url", "")}
        for a in data.get("assets", []) if isinstance(a, dict)
    ]
    return {"tag": data.get("tag_name", ""), "url": data.get("html_url") or RELEASES_PAGE, "assets": assets}


def _install_kind() -> str:
    """
    "installer" or "portable" - which kind of packaged build this running
    instance actually is, so an update points at the same kind rather than
    an arbitrary pick between the two assets every release now has per
    platform. See storage.IS_INSTALLED_APP for how this is detected - the
    same signal that decides where data/ lives, since a Program
    Files / .app bundle / AppImage install needs both handled consistently.
    """
    return "installer" if storage.IS_INSTALLED_APP else "portable"


#: Which asset extension each install kind downloads, per OS - matches the
#: filenames build-package.yml actually produces.
_KIND_EXTENSION = {
    ("Windows", "installer"): ".exe",
    ("Windows", "portable"): ".zip",
    ("Darwin", "installer"): ".dmg",
    ("Darwin", "portable"): ".zip",
    ("Linux", "installer"): ".AppImage",
    ("Linux", "portable"): ".zip",
}


def _asset_for_this_platform(assets: list[dict[str, str]]) -> dict[str, str] | None:
    """
    Match a release asset to the OS this instance is actually running on
    (the same *-x64/*-arm64 naming the release workflow uses), preferring
    the same install kind (installer vs. portable zip - see
    _install_kind()) this copy is currently running as. Falls back to
    whatever matches the platform if that exact kind isn't found - an
    older release made before installers existed, for instance.
    """
    system = platform.system()
    needle = {"Windows": "windows-x64", "Darwin": "macos-arm64", "Linux": "linux-x64"}.get(system)
    if not needle:
        return None
    matches = [a for a in assets if needle in a["name"]]
    ext = _KIND_EXTENSION.get((system, _install_kind()))
    if ext:
        preferred = next((a for a in matches if a["name"].lower().endswith(ext.lower())), None)
        if preferred:
            return preferred
    return matches[0] if matches else None


def check(force_network: bool = True) -> dict[str, Any]:
    """
    The one status object the API/UI use:

        current           this running instance's version string
        frozen            packaged build (True) vs. running from source (False)
        checked           whether a network check actually completed
        latest            tag on GitHub, or None if unchecked/unreachable
        release_url       the release (or matching asset) to point the user at
        update_available  True only when both versions parse as clean semver
                           and the release is actually newer
        method            "download" | "git_pull" | "manual" - which update
                           path applies to this install
        asset_url         the matching release asset, when method is "download"
        install_kind      "installer" | "portable" - which kind of packaged
                           build this is (see _install_kind()); asset_url
                           points at that same kind on the new release
        git_available     whether BASE_DIR is a git checkout (method "git_pull")
    """
    current = get_current_version()
    is_git = _is_git_checkout()
    result: dict[str, Any] = {
        "current": current,
        "frozen": storage.FROZEN,
        "checked": False,
        "latest": None,
        "release_url": RELEASES_PAGE,
        "update_available": False,
        "method": "download" if storage.FROZEN else ("git_pull" if is_git else "manual"),
        "asset_url": None,
        "install_kind": _install_kind() if storage.FROZEN else None,
        "git_available": is_git,
    }
    if not force_network:
        return result
    release = fetch_latest_release()
    if release is None:
        return result
    result["checked"] = True
    result["latest"] = release["tag"]
    result["release_url"] = release["url"]
    cur_v, latest_v = _semver(current), _semver(release["tag"])
    result["update_available"] = bool(cur_v and latest_v and latest_v > cur_v)
    if storage.FROZEN:
        asset = _asset_for_this_platform(release["assets"])
        result["asset_url"] = asset["url"] if asset else release["url"]
    return result


def git_pull(timeout: float = 30.0) -> dict[str, Any]:
    """
    Update a source checkout in place with `git pull --ff-only`. Only
    meaningful when NOT frozen and BASE_DIR is a real git repo - callers
    should check `git_available` from check() first.

    --ff-only rather than a plain pull: this must never create a merge
    commit or touch local history on its own. If the checkout has diverged
    (local commits, a dirty tree conflicting with upstream), the pull just
    fails with git's own message, returned as-is so the user can resolve
    it themselves - never silently discarded or force-merged.
    """
    if not _is_git_checkout():
        return {"ok": False, "output": "This isn't a git checkout, so it can't update itself this way."}
    try:
        proc = subprocess.run(
            ["git", "pull", "--ff-only"],
            cwd=storage.BASE_DIR, capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "output": f"Couldn't run git: {exc}"}
    output = (proc.stdout + proc.stderr).strip()
    return {"ok": proc.returncode == 0, "output": output or "(no output)"}
