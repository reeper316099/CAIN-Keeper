"""
models.py - default shapes for every JSON document CAIN Keeper stores.

There is no database and no ORM. Every "model" is just a plain dict that
gets written to disk as JSON by storage.py. This module holds:

  * factory functions (new_campaign(), new_exorcist(), ...) that return a
    fresh, fully-populated dict, and
  * merge_defaults(), which back-fills any keys missing from an older file
    so that adding a new field later never breaks existing saves.

All game constants that describe the physical sheet (pip counts, default
kit, the universal Blast power, ...) live here so they are easy to find.
"""

from __future__ import annotations

import copy
import secrets
import string
from datetime import datetime, timezone

# --------------------------------------------------------------------------
# Constants describing the printed CAIN sheets (v1.4.5)
# --------------------------------------------------------------------------

#: The ten registered skills, in sheet order.
SKILLS = [
    "force", "conditioning", "coordination", "covert", "interfacing",
    "investigation", "surveillance", "negotiation", "authority", "connection",
]

#: Missions-survived thresholds for CAT I..V (index 0 -> CAT 1).
CAT_THRESHOLDS = [0, 1, 2, 4, 7]

#: Number of boxes on the printed sin track before !!SIN OVERFLOW!!.
SIN_TRACK_BOXES = 10

#: Universal power every exorcist knows from the start.
BLAST_POWER = {
    "name": "Blast",
    "tags": "Instant, Short",
    "description": (
        "Spend a psyche burst and roll PSYCHE to produce a weaponized form "
        "of concentrated psychic energy in melee or short range. The specific "
        "look and feel of this basic exorcist skill varies between exorcists. "
        "The strength of this blast scales with CAT. Not Hard by default "
        "against sins."
    ),
    "known": True,
}

#: Default registered kit, straight from the sheet.
DEFAULT_KIT_ITEMS = [
    {"name": "Service Weapons", "kp": 2,
     "description": "CAT 0, upgrade +1 by spending 3 scrip to max of CAT 3"},
    {"name": "Issue Uniform", "kp": 0, "description": ""},
    {"name": "Notebook, Pen", "kp": 1, "description": ""},
    {"name": "Matchbook (20 matches), Clean Handkerchief", "kp": 1,
     "description": ""},
]

#: The seven-step mission flow ("THE HUNT").
MISSION_FLOW = [
    "Briefing", "Arrival", "Track", "Investigate", "Prepare", "Confront",
    "Execute",
]

#: GM moves offered when Tension fills. Nothing is auto-picked.
GM_MOVES = [
    "Send minions",
    "Ambush the exorcists",
    "Involve authorities",
    "Separate someone",
    "Force a difficult choice",
    "Escalate the situation",
    "Afflict the Exorcists",
    "Start or progress a ticking clock",
    "Use a domain",
    "Threaten or twist an NPC",
    "Introduce a new obstacle",
]


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

_ID_ALPHABET = string.ascii_lowercase + string.digits


def new_id(length: int = 8) -> str:
    """Short random ID (e.g. 'k3x9ab2q'). Not sequential, safe in URLs/filenames."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(length))


def now_iso() -> str:
    """UTC timestamp in ISO-8601, second precision."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def merge_defaults(obj, default):
    """
    Recursively fill in missing keys of `obj` from `default`.

    - dicts: every key in `default` that is absent from `obj` is copied in;
      nested dicts are merged the same way.
    - lists and scalars: left as-is if present in `obj`.

    This makes old save files forward-compatible when a new field is added.
    """
    if not isinstance(default, dict):
        return obj if obj is not None else copy.deepcopy(default)
    if not isinstance(obj, dict):
        return copy.deepcopy(default)
    for key, dval in default.items():
        if key not in obj:
            obj[key] = copy.deepcopy(dval)
        elif isinstance(dval, dict):
            obj[key] = merge_defaults(obj[key], dval)
    return obj


# --------------------------------------------------------------------------
# Factories
# --------------------------------------------------------------------------

def new_campaign(name: str, description: str = "", gm_name: str = "") -> dict:
    return {
        "id": new_id(),
        "name": name.strip() or "Untitled Campaign",
        "description": description.strip(),
        "gm_name": gm_name.strip(),
        "created": now_iso(),
    }


def new_blasphemy(name: str = "", library_id: str | None = None) -> dict:
    """A Blasphemy entry as it appears on an exorcist sheet."""
    return {
        "id": new_id(),
        "name": name,
        "library_id": library_id,          # id of the library entry it came from
        "description": "",
        "passive": {
            "name": "",
            "description": "",
            "track_enabled": False,        # optional 3-segment fill track
            "track_fill": 0,
        },
        "powers": [],                      # list of new_power() dicts
    }


def new_power(name="", tags="", description="", known=False) -> dict:
    return {"name": name, "tags": tags, "description": description,
            "known": known}


def new_exorcist(name: str = "") -> dict:
    """A blank exorcist sheet with every printed field represented."""
    return {
        "id": new_id(),
        "created": now_iso(),
        "updated": now_iso(),
        # --- Registered Exorcist ID card ---------------------------------
        "identity": {
            "name": name, "xid": "", "agnd": "", "blsph": "", "sex": "",
            "height": "", "weight": "", "hair": "", "eyes": "", "cid": "",
            "photo": None,                 # filename inside campaign uploads/
        },
        # --- CAT ------------------------------------------------------------
        "cat": {
            "missions_survived": 0,
            "override": False,             # True = use `value` instead of the auto-suggestion
            "value": 1,
        },
        # --- Psyche / Burst -------------------------------------------------
        "psyche": {"current": 1},          # max = ceil(CAT / 2), derived in the UI
        "burst": {"marked": 0},            # 0-3 burst pips marked (spent)
        # --- Execution / stress --------------------------------------------
        "execution": {"current": 0, "base_max": 6},   # max = base_max - active injuries
        # --- Sin ------------------------------------------------------------
        "sin_track": {
            "current": 0,
            "base_cap": SIN_TRACK_BOXES,   # printed boxes
            "crossed_out": 0,              # permanently crossed out after resistance successes
        },
        "sin_marks": [                     # 3 slots; `gained` = mark exists
            {"text": "", "gained": False},
            {"text": "", "gained": False},
            {"text": "", "gained": False},
        ],
        # --- Skills ---------------------------------------------------------
        "skills": {skill: 0 for skill in SKILLS},
        "improvements": 0,                 # 0-6 ticked boxes
        # --- Health evaluation form ---------------------------------------
        "injuries": [
            {"text": "", "active": False},
            {"text": "", "active": False},
            {"text": "", "active": False},
        ],
        "visitation_rights": False,        # unlocks the 4th "brink of death" box
        "brink": {"text": "", "active": False},
        "hooks": [
            {"name": "", "fill": 0},
            {"name": "", "fill": 0},
            {"name": "", "fill": 0},
        ],
        "afflictions": "",
        "pathos": 0,                       # Divine Agony, 0-3, clear after session
        # --- Advancement ----------------------------------------------------
        "advancement": {
            "xp": 0,
            "xp_base_max": 8,              # +1 per extra blasphemy, editable
            "advances": 0,                 # 0-3 banked advances
            "checklist": {
                "survived": False,
                "first_agenda": False,
                "bolded_agenda": False,
                "injury_or_affliction": False,
            },
        },
        # --- Registered kit -------------------------------------------------
        "kit": {
            "points_current": 9,
            "points_max": 9,
            "items": copy.deepcopy(DEFAULT_KIT_ITEMS),
            "scrip": 0,
            "scrip_log": [],               # [{ts, delta, note}]
        },
        # --- Agenda ---------------------------------------------------------
        "agenda": {
            "name": "",
            "description": "",
            "items": [],                   # [{text, bolded}]
            "abilities": [],               # [{name, description}], max 5
        },
        # --- Blasphemy ------------------------------------------------------
        "universal_powers": [copy.deepcopy(BLAST_POWER)],
        "blasphemies": [new_blasphemy()],  # 1+ entries; extras cost an Advance
        "notes": "",
    }


def new_sin(name: str = "") -> dict:
    """A blank Recorded Manifestation Field Sheet."""
    return {
        "id": new_id(),
        "created": now_iso(),
        "updated": now_iso(),
        "name": name,
        "host": "",
        "deceased": False,
        "executed_date": "",
        "type": "",
        "form": "I",                       # I / II / III
        "category": 1,                     # I-VII => 1-7 (this is the Sin's CAT)
        "traumas": ["", "", ""],
        "execution": {"slashes": 0},       # threshold = 8 + pressure + category
        "resolution": None,                # None | "executed" | "failed" | "spared"
        "domains": ["", "", ""],
        "tracks": [                        # two extra evolvable talisman-style tracks
            {"name": "", "length": 3, "fill": 0},
            {"name": "", "length": 3, "fill": 0},
        ],
        "attack_with": "",                 # "Attack with:" free text
        "severe_attack": "",               # details of the once-a-scene severe attack
        "notes": "",
    }


def new_talisman(name: str = "", length: int = 3) -> dict:
    return {"id": new_id(), "name": name, "length": length, "fill": 0}


def new_mission_tracker() -> dict:
    """Live session state for a campaign."""
    return {
        "session_name": "",
        "started": now_iso(),
        "flow": [False] * len(MISSION_FLOW),
        "tension": 0,                      # 0-3
        "pressure": 0,                     # 0-6
        "talismans": [],                   # up to 6 new_talisman()
        "notes": "",
        "log": [],                         # [{ts, text}] GM moves taken, rests, etc.
    }


def new_library_entry(name: str) -> dict:
    return {
        "id": new_id(),
        "name": name,
        "description": "",
        "passive": {"name": "", "description": "", "track_enabled": False},
        "powers": [],                      # [{name, tags, description}]
    }


def new_blasphemy_library() -> dict:
    """Twelve placeholder entries; the GM fills in real content in the UI."""
    return {"entries": [new_library_entry(f"Blasphemy {i}") for i in range(1, 13)]}


def new_roll_entry(roller: str, result: dict) -> dict:
    """Wrap a dice.py result for the roll log."""
    return {"id": new_id(6), "ts": now_iso(), "roller": roller or "GM", **result}
