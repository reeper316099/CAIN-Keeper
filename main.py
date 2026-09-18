"""
main.py - FastAPI application: HTML pages + JSON API for CAIN Keeper.

Run it with:   python main.py            (serves on http://127.0.0.1:8000)
               python main.py --open     (also opens your default browser)

Route overview
--------------
Pages (Jinja2 templates in /templates):
    /                                   campaign list + "New Campaign"
    /campaigns/{cid}                    -> redirects to the exorcist list
    /campaigns/{cid}/exorcists          party roster
    /campaigns/{cid}/exorcists/{eid}    exorcist sheet
    /campaigns/{cid}/sins               sin roster
    /campaigns/{cid}/sins/{sid}         sin sheet
    /campaigns/{cid}/mission            mission / session tracker
    /campaigns/{cid}/rolls              roll history
    /campaigns/{cid}/settings           edit / delete campaign
    /library                            global Blasphemy Library
    /cat                                global CAT reference table
    /uploads/{cid}/{filename}           exorcist photos

JSON API (everything the frontend autosaves through):
    GET/POST      /api/campaigns
    GET/PUT/DEL   /api/campaigns/{cid}
    GET/POST      /api/campaigns/{cid}/exorcists
    GET/PUT/DEL   /api/campaigns/{cid}/exorcists/{eid}
    POST/DEL      /api/campaigns/{cid}/exorcists/{eid}/photo
    GET/POST      /api/campaigns/{cid}/sins
    GET/PUT/DEL   /api/campaigns/{cid}/sins/{sid}
    GET/PUT       /api/campaigns/{cid}/mission
    POST          /api/campaigns/{cid}/mission/archive
    GET/PUT       /api/campaigns/{cid}/mission/history
    GET/DEL       /api/campaigns/{cid}/rolls
    POST          /api/campaigns/{cid}/roll       roll + log to campaign
    POST          /api/roll                        roll without logging
    GET/PUT       /api/library
    GET           /api/reference                   static rules data for the UI

The frontend works on whole documents: it GETs an exorcist, edits it in
memory, and PUTs the full object back (debounced). storage.py takes care of
atomic writes, so there's no partial-update logic to maintain.
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import Body, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import dice
import models
import storage
import updater

# Templates and static files: next to this file from source, or inside the
# PyInstaller bundle (sys._MEIPASS) when running as a packaged executable.
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


class NoCacheStaticFiles(StaticFiles):
    """
    StaticFiles that forces revalidation on every load.

    Browsers cache CSS/JS aggressively by default even without an explicit
    Cache-Control header, using a heuristic freshness window based on
    Last-Modified. That's fine for a normal website but wrong here: this is
    a locally-run app users update in place (git pull, or a new downloaded
    build) while a browser tab or profile may already have the old files
    cached, so a real fix can silently appear not to have happened. Starlette
    still sends ETag/Last-Modified, so an unchanged file gets a cheap 304 -
    this only forces the *check*, not a full re-download every time.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


app = FastAPI(title="CAIN Keeper", docs_url="/api/docs", redoc_url=None)
app.mount("/static", NoCacheStaticFiles(directory=RESOURCE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=RESOURCE_DIR / "templates")

#: Static rules data handed to the frontend once (see /api/reference).
REFERENCE = {
    "skills": models.SKILLS,
    "cat_thresholds": models.CAT_THRESHOLDS,
    "mission_flow": models.MISSION_FLOW,
    "gm_moves": models.GM_MOVES,
    "risk_tiers_default": dice.DEFAULT_RISK_TIERS,
    "max_bonus_dice": dice.MAX_BONUS_DICE,
    "blast": models.BLAST_POWER,
}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _campaign_or_404(cid: str) -> dict:
    try:
        return storage.load_campaign(cid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")


def _page(request: Request, template: str, cid: str | None = None, **ctx: Any) -> HTMLResponse:
    """Render a template with the sidebar context every page needs."""
    campaign = _campaign_or_404(cid) if cid else None
    return templates.TemplateResponse(request, template, {
        "campaigns": storage.list_campaigns(),
        "campaign": campaign,
        **ctx,
    })


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return _page(request, "index.html", active="home")


@app.get("/campaigns/{cid}")
def campaign_root(cid: str):
    _campaign_or_404(cid)
    return RedirectResponse(f"/campaigns/{cid}/exorcists")


@app.get("/campaigns/{cid}/exorcists", response_class=HTMLResponse)
def exorcists_page(request: Request, cid: str):
    return _page(request, "exorcists.html", cid, active="exorcists")


@app.get("/campaigns/{cid}/exorcists/{eid}", response_class=HTMLResponse)
def exorcist_page(request: Request, cid: str, eid: str):
    try:
        exorcist = storage.load_exorcist(cid, eid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Exorcist not found")
    return _page(request, "exorcist.html", cid, active="exorcists", exorcist=exorcist)


@app.get("/campaigns/{cid}/sins", response_class=HTMLResponse)
def sins_page(request: Request, cid: str):
    return _page(request, "sins.html", cid, active="sins")


@app.get("/campaigns/{cid}/sins/{sid}", response_class=HTMLResponse)
def sin_page(request: Request, cid: str, sid: str):
    try:
        sin = storage.load_sin(cid, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Sin not found")
    return _page(request, "sin.html", cid, active="sins", sin=sin)


@app.get("/campaigns/{cid}/mission", response_class=HTMLResponse)
def mission_page(request: Request, cid: str):
    return _page(request, "mission.html", cid, active="mission")


@app.get("/campaigns/{cid}/rolls", response_class=HTMLResponse)
def rolls_page(request: Request, cid: str):
    return _page(request, "rolls.html", cid, active="rolls")


@app.get("/campaigns/{cid}/settings", response_class=HTMLResponse)
def settings_page(request: Request, cid: str):
    return _page(request, "settings.html", cid, active="settings")


@app.get("/library", response_class=HTMLResponse)
def library_page(request: Request):
    return _page(request, "library.html", active="library")


@app.get("/cat", response_class=HTMLResponse)
def cat_page(request: Request):
    return _page(request, "cat.html", active="cat")


@app.get("/uploads/{cid}/{filename}")
def serve_upload(cid: str, filename: str):
    try:
        return FileResponse(storage.upload_path(cid, filename))
    except KeyError:
        raise HTTPException(status_code=404, detail="File not found")


# --------------------------------------------------------------------------
# API: reference + campaigns
# --------------------------------------------------------------------------

@app.get("/api/reference")
def api_reference():
    return REFERENCE


@app.get("/api/campaigns")
def api_list_campaigns():
    return storage.list_campaigns()


@app.post("/api/campaigns", status_code=201)
def api_create_campaign(payload: dict = Body(...)):
    name = str(payload.get("name", "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="Campaign name is required")
    return storage.create_campaign(name, str(payload.get("description", "")),
                                   str(payload.get("gm_name", "")))


@app.get("/api/campaigns/{cid}")
def api_get_campaign(cid: str):
    return _campaign_or_404(cid)


@app.put("/api/campaigns/{cid}")
def api_update_campaign(cid: str, payload: dict = Body(...)):
    campaign = _campaign_or_404(cid)
    for key in ("name", "description", "gm_name"):
        if key in payload:
            campaign[key] = str(payload[key])
    if not campaign["name"].strip():
        raise HTTPException(status_code=400, detail="Campaign name is required")
    return storage.save_campaign(campaign)


@app.delete("/api/campaigns/{cid}")
def api_delete_campaign(cid: str):
    _campaign_or_404(cid)
    storage.delete_campaign(cid)
    return {"ok": True}


# --------------------------------------------------------------------------
# API: exorcists
# --------------------------------------------------------------------------

@app.get("/api/campaigns/{cid}/exorcists")
def api_list_exorcists(cid: str):
    _campaign_or_404(cid)
    return storage.list_exorcists(cid)


@app.post("/api/campaigns/{cid}/exorcists", status_code=201)
def api_create_exorcist(cid: str, payload: dict = Body(default={})):
    _campaign_or_404(cid)
    exorcist = models.new_exorcist(str(payload.get("name", "")))
    return storage.save_exorcist(cid, exorcist)


@app.get("/api/campaigns/{cid}/exorcists/{eid}")
def api_get_exorcist(cid: str, eid: str):
    try:
        return storage.load_exorcist(cid, eid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Exorcist not found")


@app.put("/api/campaigns/{cid}/exorcists/{eid}")
def api_save_exorcist(cid: str, eid: str, payload: dict = Body(...)):
    """Full-document save. The id in the URL wins over the id in the body."""
    _campaign_or_404(cid)
    payload["id"] = eid
    return storage.save_exorcist(cid, payload)


@app.delete("/api/campaigns/{cid}/exorcists/{eid}")
def api_delete_exorcist(cid: str, eid: str):
    _campaign_or_404(cid)
    try:
        ex = storage.load_exorcist(cid, eid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Exorcist not found")
    if ex["identity"].get("photo"):
        storage.delete_upload(cid, ex["identity"]["photo"])
    storage.delete_exorcist(cid, eid)
    return {"ok": True}


@app.post("/api/campaigns/{cid}/exorcists/{eid}/photo")
async def api_upload_photo(cid: str, eid: str, file: UploadFile = File(...)):
    """Store an ID-card photo and record its filename on the exorcist."""
    try:
        ex = storage.load_exorcist(cid, eid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Exorcist not found")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads are allowed")
    content = await file.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image larger than 8 MB")
    ext = Path(file.filename or "photo.png").suffix or ".png"
    if ex["identity"].get("photo"):
        storage.delete_upload(cid, ex["identity"]["photo"])
    stored = storage.save_upload(cid, f"{eid}_{models.new_id(4)}{ext}", content)
    ex["identity"]["photo"] = stored
    storage.save_exorcist(cid, ex)
    return {"photo": stored, "url": f"/uploads/{cid}/{stored}"}


@app.delete("/api/campaigns/{cid}/exorcists/{eid}/photo")
def api_delete_photo(cid: str, eid: str):
    try:
        ex = storage.load_exorcist(cid, eid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Exorcist not found")
    if ex["identity"].get("photo"):
        storage.delete_upload(cid, ex["identity"]["photo"])
        ex["identity"]["photo"] = None
        storage.save_exorcist(cid, ex)
    return {"ok": True}


# --------------------------------------------------------------------------
# API: sins
# --------------------------------------------------------------------------

@app.get("/api/campaigns/{cid}/sins")
def api_list_sins(cid: str):
    _campaign_or_404(cid)
    return storage.list_sins(cid)


@app.post("/api/campaigns/{cid}/sins", status_code=201)
def api_create_sin(cid: str, payload: dict = Body(default={})):
    _campaign_or_404(cid)
    return storage.save_sin(cid, models.new_sin(str(payload.get("name", ""))))


@app.get("/api/campaigns/{cid}/sins/{sid}")
def api_get_sin(cid: str, sid: str):
    try:
        return storage.load_sin(cid, sid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Sin not found")


@app.put("/api/campaigns/{cid}/sins/{sid}")
def api_save_sin(cid: str, sid: str, payload: dict = Body(...)):
    _campaign_or_404(cid)
    payload["id"] = sid
    return storage.save_sin(cid, payload)


@app.delete("/api/campaigns/{cid}/sins/{sid}")
def api_delete_sin(cid: str, sid: str):
    _campaign_or_404(cid)
    storage.delete_sin(cid, sid)
    return {"ok": True}


# --------------------------------------------------------------------------
# API: mission tracker
# --------------------------------------------------------------------------

@app.get("/api/campaigns/{cid}/mission")
def api_get_mission(cid: str):
    _campaign_or_404(cid)
    return storage.load_mission(cid)


@app.put("/api/campaigns/{cid}/mission")
def api_save_mission(cid: str, payload: dict = Body(...)):
    _campaign_or_404(cid)
    return storage.save_mission(cid, payload)


@app.post("/api/campaigns/{cid}/mission/archive")
def api_archive_mission(cid: str, payload: dict = Body(default={})):
    """
    Close the current session: push a summary onto mission_history.json and
    reset the live tracker (flow, tension, talismans, log). Pressure is kept
    unless `reset_pressure` is true, because it usually carries between
    sessions of the same hunt.
    """
    _campaign_or_404(cid)
    tracker = storage.load_mission(cid)
    flow = tracker.get("flow", [])
    summary = {
        "id": models.new_id(6),
        "session_name": tracker.get("session_name", ""),
        "started": tracker.get("started"),
        "ended": models.now_iso(),
        "summary": str(payload.get("summary", "")),
        # The running "Notes" field is separate from the archive modal's own
        # wrap-up summary - it was being discarded when the tracker reset.
        "notes": tracker.get("notes", ""),
        "pressure_final": tracker.get("pressure", 0),
        "flow": flow,  # raw per-step booleans, for the history detail view
        "flow_completed": sum(1 for f in flow if f),
        "talismans": tracker.get("talismans", []),
        "log": tracker.get("log", []),
    }
    storage.append_mission_history(cid, summary)
    fresh = models.new_mission_tracker()
    if not payload.get("reset_pressure"):
        fresh["pressure"] = tracker.get("pressure", 0)
    storage.save_mission(cid, fresh)
    return {"history_entry": summary, "tracker": fresh}


@app.get("/api/campaigns/{cid}/mission/history")
def api_mission_history(cid: str):
    _campaign_or_404(cid)
    return storage.load_mission_history(cid)


@app.put("/api/campaigns/{cid}/mission/history")
def api_save_mission_history(cid: str, payload: list = Body(...)):
    _campaign_or_404(cid)
    return storage.save_mission_history(cid, payload)


# --------------------------------------------------------------------------
# API: dice + roll history
# --------------------------------------------------------------------------

def _do_roll(payload: dict) -> dict:
    try:
        return dice.roll(str(payload.get("kind", "")), payload.get("params") or {})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/roll")
def api_roll_unlogged(payload: dict = Body(...)):
    """Roll without a campaign (e.g. from the Library or CAT pages)."""
    result = _do_roll(payload)
    return models.new_roll_entry(str(payload.get("roller", "")), result)


@app.post("/api/campaigns/{cid}/roll")
def api_roll_logged(cid: str, payload: dict = Body(...)):
    """Roll and append the result to this campaign's roll_history.json."""
    _campaign_or_404(cid)
    result = _do_roll(payload)
    entry = models.new_roll_entry(str(payload.get("roller", "")), result)
    storage.append_roll(cid, entry)
    return entry


@app.get("/api/campaigns/{cid}/rolls")
def api_list_rolls(cid: str):
    _campaign_or_404(cid)
    return storage.load_rolls(cid)


@app.delete("/api/campaigns/{cid}/rolls")
def api_clear_rolls(cid: str):
    _campaign_or_404(cid)
    storage.clear_rolls(cid)
    return {"ok": True}


# --------------------------------------------------------------------------
# API: blasphemy library
# --------------------------------------------------------------------------

@app.get("/api/library")
def api_get_library():
    return storage.load_library()


@app.put("/api/library")
def api_save_library(payload: dict = Body(...)):
    if not isinstance(payload.get("entries"), list):
        raise HTTPException(status_code=400, detail="Library must have an 'entries' list")
    return storage.save_library(payload)


# --------------------------------------------------------------------------
# API: update check
# --------------------------------------------------------------------------
#
# A background thread does one network check at startup (see main()) and
# caches the result here, so GET /api/update - called once by the sidebar
# on every page load - never itself makes a network call and is instant
# even fully offline. The explicit "Check now" action hits GitHub directly
# and is allowed to block briefly, since the user asked for it.

_update_cache: dict[str, Any] | None = None


@app.get("/api/update")
def api_update_status():
    """Cheap, local, no network call: whatever the startup check found (or
    just the always-available local facts, if that check hasn't finished
    or hasn't run yet)."""
    return _update_cache or updater.check(force_network=False)


@app.post("/api/update/refresh")
def api_update_refresh():
    """Explicit "Check now": a fresh network check, blocking, caching the
    result for subsequent GET /api/update calls too."""
    global _update_cache
    _update_cache = updater.check(force_network=True)
    return _update_cache


@app.post("/api/update/git-pull")
def api_update_git_pull():
    """Update a source checkout in place. No-op-safe on a packaged build
    or a non-git source tree - updater.git_pull() reports why rather than
    failing oddly."""
    return updater.git_pull()


# --------------------------------------------------------------------------
# Error pages
# --------------------------------------------------------------------------

@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    """HTML error page for browser navigation, JSON for API calls."""
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return templates.TemplateResponse(request, "error.html", {
        "campaigns": storage.list_campaigns(), "campaign": None,
        "status": exc.status_code, "detail": exc.detail,
    }, status_code=exc.status_code)


# --------------------------------------------------------------------------
# Entrypoint
# --------------------------------------------------------------------------

def _open_browser_when_ready(url: str, host: str, port: int, timeout: float = 20.0) -> None:
    """Poll the port until the server answers, then open the default browser."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                break
        except OSError:
            time.sleep(0.25)
    webbrowser.open(url)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run CAIN Keeper")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--open", action="store_true", help="open the browser once the server is up")
    parser.add_argument("--no-open", action="store_true", help="never open the browser (packaged builds open it by default)")
    parser.add_argument("--reload", action="store_true", help="auto-reload on code changes (dev, source only)")
    args = parser.parse_args()

    storage.load_library()  # seeds blasphemy_library.json on first run

    def _check_for_update_in_background() -> None:
        # One best-effort network call, off the main thread, so a slow or
        # absent connection (this app is meant to work fully offline at a
        # table with no wifi) never delays startup. Silent on any failure -
        # see updater.check()'s "checked" field.
        global _update_cache
        _update_cache = updater.check(force_network=True)

    threading.Thread(target=_check_for_update_in_background, daemon=True).start()

    url = f"http://{args.host}:{args.port}"
    # A double-clicked packaged executable should just open the app.
    open_browser = (args.open or storage.FROZEN) and not args.no_open
    if open_browser:
        threading.Thread(target=_open_browser_when_ready, args=(url, args.host, args.port),
                         daemon=True).start()
    print(f"CAIN Keeper running at {url}  (Ctrl+C to stop)")
    print(f"Data folder: {storage.DATA_DIR}")
    if args.reload and not storage.FROZEN:
        uvicorn.run("main:app", host=args.host, port=args.port, reload=True)
    else:
        # Pass the app object (not an import string) so this works inside a
        # PyInstaller bundle where module discovery is limited.
        uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
