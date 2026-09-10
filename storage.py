"""
storage.py - the ONLY module that touches the filesystem.

Layout on disk (relative to this file):

    data/
      blasphemy_library.json          shared across all campaigns
      campaigns/
        {campaign_id}/
          campaign.json               name, description, GM name, created date
          exorcists.json              list of exorcist dicts
          sins.json                   list of sin dicts
          mission_tracker.json        current session state
          mission_history.json        list of past session summaries
          roll_history.json           log of dice rolls
          uploads/                    exorcist photos

Design rules
------------
* pathlib everywhere, so the same code runs on Windows and macOS.
* Every write is atomic: the JSON is written to a temp file in the same
  directory, flushed + fsync'd, then os.replace()d over the target. A crash
  mid-save leaves the old file intact.
* One in-process threading.Lock per file path. This is a single-user app,
  so that's all the concurrency control we need (FastAPI may still service
  two requests at once, e.g. an autosave racing a dice roll).
* Everything else in the app calls the high-level functions at the bottom
  (load_campaign, save_exorcist, append_roll, ...). Nothing else opens files.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
from collections import defaultdict
from pathlib import Path
from typing import Any

import models

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CAMPAIGNS_DIR = DATA_DIR / "campaigns"
LIBRARY_FILE = DATA_DIR / "blasphemy_library.json"

#: Max entries kept in roll_history.json (oldest are dropped).
ROLL_HISTORY_LIMIT = 2000


def campaign_dir(campaign_id: str) -> Path:
    """Folder for one campaign. Validates the id so it can't escape data/."""
    if not campaign_id or any(c in campaign_id for c in "/\\.") :
        raise KeyError(f"Bad campaign id: {campaign_id!r}")
    return CAMPAIGNS_DIR / campaign_id


def uploads_dir(campaign_id: str) -> Path:
    return campaign_dir(campaign_id) / "uploads"


# --------------------------------------------------------------------------
# Low-level JSON I/O (atomic + locked)
# --------------------------------------------------------------------------

_locks: dict[Path, threading.Lock] = defaultdict(threading.Lock)
_locks_guard = threading.Lock()


def _lock_for(path: Path) -> threading.Lock:
    with _locks_guard:
        return _locks[path]


def _read_json(path: Path, default: Any) -> Any:
    """Read JSON from `path`; return a deep copy of `default` if it's missing."""
    if not path.exists():
        return json.loads(json.dumps(default))
    with _lock_for(path):
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)


def _write_json(path: Path, data: Any) -> None:
    """
    Atomically write `data` as pretty JSON to `path`.

    Steps: write to a temp file next to the target -> flush -> fsync ->
    os.replace(). os.replace is atomic on POSIX and on Windows (NTFS), and
    overwrites an existing target.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with _lock_for(path):
        fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp",
                                        dir=path.parent)
        tmp_path = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(data, fh, indent=2, ensure_ascii=False)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, path)
        finally:
            # If anything went wrong before the rename, don't leave junk behind.
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass


# --------------------------------------------------------------------------
# Blasphemy library (global)
# --------------------------------------------------------------------------

def load_library() -> dict:
    """Return the shared library, seeding 12 placeholders on first run."""
    if not LIBRARY_FILE.exists():
        lib = models.new_blasphemy_library()
        _write_json(LIBRARY_FILE, lib)
        return lib
    lib = _read_json(LIBRARY_FILE, {"entries": []})
    for entry in lib.get("entries", []):
        models.merge_defaults(entry, models.new_library_entry(""))
    return lib


def save_library(lib: dict) -> dict:
    _write_json(LIBRARY_FILE, lib)
    return lib


# --------------------------------------------------------------------------
# Campaigns
# --------------------------------------------------------------------------

def list_campaigns() -> list[dict]:
    """All campaign.json files, sorted by creation date."""
    CAMPAIGNS_DIR.mkdir(parents=True, exist_ok=True)
    out = []
    for folder in CAMPAIGNS_DIR.iterdir():
        meta = folder / "campaign.json"
        if folder.is_dir() and meta.exists():
            out.append(_read_json(meta, {}))
    out.sort(key=lambda c: c.get("created", ""))
    return out


def load_campaign(campaign_id: str) -> dict:
    """campaign.json for one campaign. Raises KeyError if missing."""
    meta = campaign_dir(campaign_id) / "campaign.json"
    if not meta.exists():
        raise KeyError(campaign_id)
    return _read_json(meta, {})


def create_campaign(name: str, description: str = "", gm_name: str = "") -> dict:
    """Create the folder + all starter files for a new campaign."""
    camp = models.new_campaign(name, description, gm_name)
    folder = campaign_dir(camp["id"])
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "uploads").mkdir(exist_ok=True)
    _write_json(folder / "campaign.json", camp)
    _write_json(folder / "exorcists.json", [])
    _write_json(folder / "sins.json", [])
    _write_json(folder / "mission_tracker.json", models.new_mission_tracker())
    _write_json(folder / "mission_history.json", [])
    _write_json(folder / "roll_history.json", [])
    return camp


def save_campaign(campaign: dict) -> dict:
    folder = campaign_dir(campaign["id"])
    if not folder.exists():
        raise KeyError(campaign["id"])
    _write_json(folder / "campaign.json", campaign)
    return campaign


def delete_campaign(campaign_id: str) -> None:
    """Remove the whole campaign folder (irreversible)."""
    folder = campaign_dir(campaign_id)
    if folder.exists():
        shutil.rmtree(folder)


# --------------------------------------------------------------------------
# Generic list-file helpers (exorcists.json / sins.json share a shape)
# --------------------------------------------------------------------------

def _list_file(campaign_id: str, filename: str) -> Path:
    folder = campaign_dir(campaign_id)
    if not folder.exists():
        raise KeyError(campaign_id)
    return folder / filename


def _load_list(campaign_id: str, filename: str, default_factory) -> list[dict]:
    items = _read_json(_list_file(campaign_id, filename), [])
    # Back-fill any fields added since the file was written.
    return [models.merge_defaults(item, default_factory()) for item in items]


def _save_list(campaign_id: str, filename: str, items: list[dict]) -> None:
    _write_json(_list_file(campaign_id, filename), items)


def _upsert(items: list[dict], obj: dict) -> list[dict]:
    """Replace the item with the same id, or append if new."""
    for i, existing in enumerate(items):
        if existing.get("id") == obj.get("id"):
            items[i] = obj
            return items
    items.append(obj)
    return items


# --------------------------------------------------------------------------
# Exorcists
# --------------------------------------------------------------------------

def list_exorcists(campaign_id: str) -> list[dict]:
    return _load_list(campaign_id, "exorcists.json", models.new_exorcist)


def load_exorcist(campaign_id: str, exorcist_id: str) -> dict:
    for ex in list_exorcists(campaign_id):
        if ex["id"] == exorcist_id:
            return ex
    raise KeyError(exorcist_id)


def save_exorcist(campaign_id: str, exorcist: dict) -> dict:
    exorcist = models.merge_defaults(exorcist, models.new_exorcist())
    exorcist["updated"] = models.now_iso()
    items = _upsert(list_exorcists(campaign_id), exorcist)
    _save_list(campaign_id, "exorcists.json", items)
    return exorcist


def delete_exorcist(campaign_id: str, exorcist_id: str) -> None:
    items = [e for e in list_exorcists(campaign_id) if e["id"] != exorcist_id]
    _save_list(campaign_id, "exorcists.json", items)


# --------------------------------------------------------------------------
# Sins
# --------------------------------------------------------------------------

def list_sins(campaign_id: str) -> list[dict]:
    return _load_list(campaign_id, "sins.json", models.new_sin)


def load_sin(campaign_id: str, sin_id: str) -> dict:
    for sin in list_sins(campaign_id):
        if sin["id"] == sin_id:
            return sin
    raise KeyError(sin_id)


def save_sin(campaign_id: str, sin: dict) -> dict:
    sin = models.merge_defaults(sin, models.new_sin())
    sin["updated"] = models.now_iso()
    items = _upsert(list_sins(campaign_id), sin)
    _save_list(campaign_id, "sins.json", items)
    return sin


def delete_sin(campaign_id: str, sin_id: str) -> None:
    items = [s for s in list_sins(campaign_id) if s["id"] != sin_id]
    _save_list(campaign_id, "sins.json", items)


# --------------------------------------------------------------------------
# Mission tracker + history
# --------------------------------------------------------------------------

def load_mission(campaign_id: str) -> dict:
    data = _read_json(_list_file(campaign_id, "mission_tracker.json"),
                      models.new_mission_tracker())
    return models.merge_defaults(data, models.new_mission_tracker())


def save_mission(campaign_id: str, tracker: dict) -> dict:
    tracker = models.merge_defaults(tracker, models.new_mission_tracker())
    _write_json(_list_file(campaign_id, "mission_tracker.json"), tracker)
    return tracker


def load_mission_history(campaign_id: str) -> list[dict]:
    return _read_json(_list_file(campaign_id, "mission_history.json"), [])


def append_mission_history(campaign_id: str, summary: dict) -> list[dict]:
    history = load_mission_history(campaign_id)
    history.append(summary)
    _write_json(_list_file(campaign_id, "mission_history.json"), history)
    return history


def save_mission_history(campaign_id: str, history: list[dict]) -> list[dict]:
    _write_json(_list_file(campaign_id, "mission_history.json"), history)
    return history


# --------------------------------------------------------------------------
# Roll history
# --------------------------------------------------------------------------

def load_rolls(campaign_id: str) -> list[dict]:
    return _read_json(_list_file(campaign_id, "roll_history.json"), [])


def append_roll(campaign_id: str, entry: dict) -> dict:
    rolls = load_rolls(campaign_id)
    rolls.append(entry)
    if len(rolls) > ROLL_HISTORY_LIMIT:
        rolls = rolls[-ROLL_HISTORY_LIMIT:]
    _write_json(_list_file(campaign_id, "roll_history.json"), rolls)
    return entry


def clear_rolls(campaign_id: str) -> None:
    _write_json(_list_file(campaign_id, "roll_history.json"), [])


# --------------------------------------------------------------------------
# Uploads (exorcist photos)
# --------------------------------------------------------------------------

def save_upload(campaign_id: str, filename: str, content: bytes) -> str:
    """
    Store raw bytes under the campaign's uploads/ folder and return the
    stored filename. The name is sanitised to a safe basename.
    """
    safe = "".join(c for c in Path(filename).name if c.isalnum() or c in "._-")
    if not safe:
        safe = "upload"
    folder = uploads_dir(campaign_id)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / safe
    with _lock_for(target):
        fd, tmp_name = tempfile.mkstemp(prefix=safe + ".", suffix=".tmp", dir=folder)
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, target)
    return safe


def upload_path(campaign_id: str, filename: str) -> Path:
    """Resolve an upload for serving; raises KeyError if it isn't there."""
    path = uploads_dir(campaign_id) / Path(filename).name
    if not path.is_file():
        raise KeyError(filename)
    return path


def delete_upload(campaign_id: str, filename: str) -> None:
    try:
        upload_path(campaign_id, filename).unlink()
    except (KeyError, OSError):
        pass
