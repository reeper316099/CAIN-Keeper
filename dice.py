"""
dice.py - the dice engine. Pure functions, no I/O, no FastAPI.

Every function returns a plain dict that the frontend renders and that
storage.append_roll() writes to roll_history.json unchanged. Each result
carries:

    kind    - which roller produced it ("pool", "risk", "simple",
              "resistance", "rest", "trauma")
    label   - short human-readable name for the log ("Force +1D", "1d3", ...)
    summary - one-line text description of the outcome
    ...     - kind-specific detail fields

Rules implemented (CAIN 1.4.5 sheets):
  * Action roll: pool of d6; 4+ is a success, or 6 only when Hard. Four or
    more successes is a full success. "Risky" is only a label - the Admin
    rolls the risk die separately.
  * Bonus dice cap at +3 (we warn, but still roll what was asked).
  * Risk / reaction die: 1d6, tiered 1 / 2-3 / 4-6.
  * Sin resistance: 1d6 + sin marks. Total <= 7 -> gain a mark and keep
    control. A natural 1 always succeeds.
  * Rest: 2d3 reported individually so each can be assigned.
  * Trauma counter: 1d3 stress reduced and 1d3 slashes inflicted.
"""

from __future__ import annotations

import random

_rng = random.SystemRandom()

#: Bonus dice above this trigger a UI warning ("...+3 dice maximum").
MAX_BONUS_DICE = 3

#: Default tier labels for the risk die. Callers override per table.
DEFAULT_RISK_TIERS = {
    "1": "Strongest / worst outcome",
    "2-3": "Moderate outcome",
    "4-6": "Weakest outcome",
}


def d(sides: int) -> int:
    return _rng.randint(1, sides)


def roll_dice(count: int, sides: int) -> list[int]:
    count = max(0, int(count))
    return [d(sides) for _ in range(count)]


# --------------------------------------------------------------------------
# 1. Action pool
# --------------------------------------------------------------------------

def roll_action_pool(skill_dice: int, bonus_dice: int = 0, hard: bool = False,
                     risky: bool = False, label: str = "") -> dict:
    """
    Roll (skill_dice + bonus_dice) d6 and count successes.

    A pool of zero dice is allowed (CAIN lets you roll 0 dice - here we just
    report zero successes; adjust to your table's house rule if needed).
    """
    skill_dice = max(0, int(skill_dice))
    bonus_dice = max(0, int(bonus_dice))
    total_dice = skill_dice + bonus_dice
    dice = roll_dice(total_dice, 6)
    threshold = 6 if hard else 4
    successes = sum(1 for x in dice if x >= threshold)
    full = successes >= 4
    parts = []
    if hard:
        parts.append("Hard")
    if risky:
        parts.append("Risky")
    tag = f" [{', '.join(parts)}]" if parts else ""
    summary = (f"{successes} success{'es' if successes != 1 else ''}"
               f"{' - FULL SUCCESS' if full else ''}{tag}")
    return {
        "kind": "pool",
        "label": label or f"{total_dice}d6 action",
        "dice": dice,
        "skill_dice": skill_dice,
        "bonus_dice": bonus_dice,
        "bonus_warning": bonus_dice > MAX_BONUS_DICE,
        "hard": hard,
        "risky": risky,
        "threshold": threshold,
        "successes": successes,
        "full_success": full,
        "no_successes": successes == 0,
        "summary": summary,
    }


# --------------------------------------------------------------------------
# 2. Risk / reaction die
# --------------------------------------------------------------------------

def risk_tier_key(value: int) -> str:
    if value == 1:
        return "1"
    if value <= 3:
        return "2-3"
    return "4-6"


def roll_risk_die(tiers: dict | None = None, label: str = "") -> dict:
    """Single d6 with a tier callout. `tiers` maps '1', '2-3', '4-6' -> text."""
    tiers = {**DEFAULT_RISK_TIERS, **(tiers or {})}
    value = d(6)
    key = risk_tier_key(value)
    return {
        "kind": "risk",
        "label": label or "Risk die",
        "value": value,
        "tier": key,
        "tier_text": tiers.get(key, ""),
        "tiers": tiers,
        "natural_one": value == 1,
        "summary": f"{value} -> [{key}] {tiers.get(key, '')}",
    }


# --------------------------------------------------------------------------
# 3. Simple dice
# --------------------------------------------------------------------------

SIMPLE_EXPRESSIONS = {"1d6": (1, 6), "1d3": (1, 3), "2d3": (2, 3), "2d6": (2, 6)}


def roll_simple(expression: str, label: str = "") -> dict:
    """Roll one of the fixed simple expressions ('1d6', '1d3', '2d3', '2d6')."""
    expression = expression.lower().strip()
    if expression not in SIMPLE_EXPRESSIONS:
        raise ValueError(f"Unsupported dice expression: {expression}")
    count, sides = SIMPLE_EXPRESSIONS[expression]
    dice = roll_dice(count, sides)
    total = sum(dice)
    return {
        "kind": "simple",
        "label": label or expression,
        "expression": expression,
        "dice": dice,
        "total": total,
        "summary": f"{expression} = {total}" + (f" ({' + '.join(map(str, dice))})" if count > 1 else ""),
    }


def roll_sin_resistance(sin_marks: int, label: str = "") -> dict:
    """
    Sin overflow resistance check: 1d6 + number of sin marks.
    Total <= 7 -> gain a sin mark and keep control (then clear all sin and
    permanently cross out two boxes). A natural 1 always succeeds.
    Otherwise: give up.
    """
    sin_marks = max(0, int(sin_marks))
    die = d(6)
    total = die + sin_marks
    natural_one = die == 1
    success = natural_one or total <= 7
    if success:
        summary = (f"{die} + {sin_marks} marks = {total} -> KEEP CONTROL: gain a sin "
                   f"mark, clear all sin, cross out two boxes"
                   + (" (natural 1 always succeeds)" if natural_one else ""))
    else:
        summary = f"{die} + {sin_marks} marks = {total} -> GIVE UP (total above 7)"
    return {
        "kind": "resistance",
        "label": label or "Sin resistance",
        "die": die,
        "sin_marks": sin_marks,
        "total": total,
        "natural_one": natural_one,
        "success": success,
        "summary": summary,
    }


# --------------------------------------------------------------------------
# 4. Rest
# --------------------------------------------------------------------------

def roll_rest(label: str = "") -> dict:
    """2d3, each reported separately so the GM can assign them one by one."""
    dice = roll_dice(2, 3)
    return {
        "kind": "rest",
        "label": label or "Rest (2d3)",
        "dice": dice,
        "summary": f"Rest: d3 = {dice[0]}, d3 = {dice[1]} (assign each to psyche burst / stress / hook)",
    }


# --------------------------------------------------------------------------
# 5. Trauma counter (sin sheet)
# --------------------------------------------------------------------------

def roll_trauma(label: str = "") -> dict:
    """Using a trauma: reduce stress on one target by 1d3, inflict 1d3 slashes."""
    reduce = d(3)
    slashes = d(3)
    return {
        "kind": "trauma",
        "label": label or "Trauma counter",
        "stress_reduced": reduce,
        "slashes": slashes,
        "summary": f"Trauma: reduce stress by {reduce}, inflict {slashes} slash{'es' if slashes != 1 else ''}",
    }


# --------------------------------------------------------------------------
# Dispatcher used by the API
# --------------------------------------------------------------------------

def roll(kind: str, params: dict | None = None) -> dict:
    """
    Single entry point: roll("pool", {...}) etc. Unknown kinds raise ValueError.
    The `params` keys mirror each function's keyword arguments.
    """
    p = params or {}
    label = str(p.get("label", "") or "")
    if kind == "pool":
        return roll_action_pool(p.get("skill_dice", 0), p.get("bonus_dice", 0),
                                bool(p.get("hard", False)), bool(p.get("risky", False)),
                                label)
    if kind == "risk":
        return roll_risk_die(p.get("tiers"), label)
    if kind == "simple":
        return roll_simple(str(p.get("expression", "1d6")), label)
    if kind == "resistance":
        return roll_sin_resistance(p.get("sin_marks", 0), label)
    if kind == "rest":
        return roll_rest(label)
    if kind == "trauma":
        return roll_trauma(label)
    raise ValueError(f"Unknown roll kind: {kind}")
