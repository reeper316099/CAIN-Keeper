# CAIN Keeper

A local web app for running the tabletop RPG **CAIN**: exorcist character
sheets, sin sheets, a GM mission/session tracker, a shared Blasphemy Library,
the CAT reference table and a dice roller that is always one click away.
It replaces the printed 1.4.5 sheets and runs identically on Windows and macOS.

Everything is stored as plain JSON files under `data/`. No database, no
accounts, no internet required once installed.

## Quick start

| Platform | Command |
| --- | --- |
| Windows | double-click `setup.bat` |
| macOS / Linux | `./setup.sh` |

Both scripts create a virtual environment in `.venv`, install
`requirements.txt`, start the server and open `http://127.0.0.1:8000` in your
default browser. Run the same script again next time; it only reinstalls what
changed. Python 3.10 or newer is required.

To start the server by hand once the environment exists:

```
python main.py            # serve only
python main.py --open     # serve and open the browser
python main.py --port 9000
```

## Packaged releases (no Python needed)

Every push to `main` builds a standalone package for each platform with
PyInstaller; download it from the workflow run's artifacts. Pushing a tag such
as `v1.0.0` attaches the three zips to a GitHub Release:

| Workflow | Runner | Archive |
| --- | --- | --- |
| `Package · Windows` | windows-latest | `CAIN-Keeper-<version>-windows-x64.zip` |
| `Package · macOS` | macos-latest (Apple Silicon) | `CAIN-Keeper-<version>-macos-arm64.zip` |
| `Package · Linux` | ubuntu-latest | `CAIN-Keeper-<version>-linux-x64.zip` |

Unzip, then run `CAIN-Keeper.exe` (Windows) or `./CAIN-Keeper` (macOS/Linux).
The app opens your browser automatically and creates its `data/` folder next
to the executable. Pass `--no-open` to skip the browser, `--port 9000` to
change the port, or set `CAIN_KEEPER_DATA=/some/folder` to keep saves
elsewhere.

The builds are not code-signed. macOS will quarantine the download; clear it
once with `xattr -dr com.apple.quarantine CAIN-Keeper` (or right-click →
Open). Windows SmartScreen may ask you to confirm the first launch.

To cut a release:

```
git tag v1.0.0
git push origin v1.0.0
```

To build locally instead: `pip install pyinstaller && pyinstaller cain_keeper.spec`
(output in `dist/CAIN-Keeper/`, verified by `python scripts/smoke_test.py`).

## Layout of the project

| File / folder | Purpose |
| --- | --- |
| `main.py` | FastAPI app: HTML pages and the JSON API. Entry point. |
| `storage.py` | The only module that touches disk. Atomic JSON writes, one lock per file. |
| `models.py` | Default shape of every document plus sheet constants (skills, GM moves, Blast, kit). |
| `dice.py` | Dice engine. Pure functions, no I/O. |
| `templates/` | Jinja2 pages. `base.html` holds the sidebar and the dice panel. |
| `static/js/app.js` | Shared helpers: API wrapper, two-way binding, pip trackers, debounced autosave. |
| `static/js/dice.js` | The dice panel. |
| `static/js/exorcist.js`, `sin.js`, `mission.js`, `library.js` | One script per sheet. |
| `static/css/style.css` | Dark theme, single accent colour. |
| `data/` | Your saves (see below). |
| `cain_keeper.spec` | PyInstaller build recipe used by the release workflows. |
| `scripts/smoke_test.py` | Starts a packaged build and checks it answers. |
| `.github/workflows/` | Per-OS package workflows plus the shared build job. |

## Where your data lives

```
data/
  blasphemy_library.json          shared by every campaign
  campaigns/
    <campaign id>/
      campaign.json               name, description, GM, created date
      exorcists.json              every exorcist sheet in the campaign
      sins.json                   every sin sheet
      mission_tracker.json        live session state
      mission_history.json        archived sessions
      roll_history.json           dice log (capped at 2000 entries)
      uploads/                    ID-card photos
```

IDs are short random strings, so folders can be copied between machines or
merged without collisions. Writes go to a temp file and are renamed into
place, so a crash mid-save never corrupts a sheet. The frontend waits 500 ms
after your last edit before saving, so rapid pip clicking does not hammer the
disk.

`data/campaigns/` is git-ignored by default. Remove that line from
`.gitignore` if you want to version-control your campaigns.

## How the pieces map to the printed sheets

* **Exorcist sheet**: ID card (with photo upload), the ten skills with six
  improvement boxes and the two-skills-at-3 cap, CAT suggested from missions
  survived (0/1/2/4/7) with an override, Psyche (half CAT rounded up), three
  Burst pips (spend one, or roll 1d3 sin instead), Execution (6 minus active
  injuries), the ten-box sin track with crossed-out boxes and the resistance
  roll, three sin mark slots, three injuries plus the brink-of-death box gated
  behind visitation rights, three hooks with 3-segment tracks, afflictions,
  pathos, XP (expandable) and three advances with the four end-of-session
  questions, kit points and items, scrip with a log, agenda items with a bold
  toggle and up to five abilities, and one or more Blasphemies each with a
  passive and a list of powers. Every exorcist starts with the universal
  Blast power. Adding a second Blasphemy crosses out a sin box and raises XP
  to advance by one automatically.
* **Sin sheet**: vital information card, three traumas wired to the
  "reduce stress 1d3 / inflict 1d3 slashes" roll, an execution talisman whose
  length is 8 + campaign pressure + sin CAT, Execute/Fail/Spare (Spare needs a
  trauma), three domains, two extra tracks, and the Attack / Complicate /
  Threaten tables. Each table's Roll button loads its tier labels into the
  dice panel's reaction die.
* **Mission tracker**: the seven-step Hunt, Tension (3) which prompts a GM
  move and bumps Pressure when it fills, Pressure (6) which flags "out of
  control" and offers a +1 CAT shortcut for each sin, up to six talismans, a
  Rest button that rolls 2d3 and lets you assign each d3 to any exorcist, a
  session log, and End Session which archives a summary.
* **Blasphemy Library**: twelve placeholder entries to fill in. Exorcist
  sheets can pick a name from the library and import its passive and powers.
* **CAT reference**: the seven-tier table and the comparison rules.

## Dice panel

Docked on the right of every page (collapsible; unpin it to float over the
page instead). Action pools count 4+ as a success, or 6 only when Hard, and
flag four or more successes as a full success; bonus dice above +3 show a
warning. The reaction die shows tier text for 1 / 2-3 / 4-6 and the labels are
editable. Simple dice, sin resistance (1d6 + marks, 7 or lower keeps control,
natural 1 always succeeds) and Rest (2d3 shown separately) are also there.
Every roll is written to the current campaign's roll history with a
timestamp and the roller's name.

## API

The frontend talks to a small JSON API documented at `/api/docs` while the
server is running. Each sheet is loaded and saved as one document, so you can
also script against it with `curl` if you like.
