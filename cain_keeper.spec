# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for CAIN Keeper.

Build with:   pyinstaller cain_keeper.spec
Result:       dist/CAIN-Keeper/  (one-folder build: the executable plus the
              bundled templates, static files and Python runtime), and on
              macOS also dist/CAIN Keeper.app (a proper app bundle wrapping
              the same folder, built by BUNDLE() below).

The data/ folder is NOT bundled. The app creates it next to the executable on
first launch (see storage.py), so your saves stay outside the build output.
The GitHub release workflows in .github/workflows use this same spec, then
wrap its output into a per-platform installer (Inno Setup on Windows, a .dmg
on macOS, an AppImage on Linux) - see build-package.yml.

The bundled VERSION file (see updater.py) is what a packaged build reports
itself as in the in-app update check. The release workflow overwrites it
with the actual tag before running PyInstaller; the committed placeholder
here just means a manual local build never fails on a missing file.

console=True on every platform: the app opens as a native window
(main.py's --native mode, the default for a packaged build) with the
terminal alongside it for anyone who wants to see the server log or Ctrl+C
it. If pywebview can't create a window (most likely a Linux machine without
system WebKitGTK installed - see README.md), main.py falls back to serving
in that same terminal and opening a browser tab instead, so there's always
a visible window either way.
"""

import re
import sys

from PyInstaller.utils.hooks import collect_submodules

try:
    _raw_version = open("VERSION").read().strip()
except OSError:
    _raw_version = ""
_match = re.match(r"v?(\d+(?:\.\d+){0,2})", _raw_version)
bundle_version = _match.group(1) if _match else "0.0.0"

hiddenimports = (
    collect_submodules("uvicorn")          # protocol/loop implementations are imported by name
    + collect_submodules("anyio")
    + collect_submodules("starlette")
    + collect_submodules("fastapi")
    + collect_submodules("jinja2")
    + collect_submodules("webview")
)
# python-multipart exposes different top-level package names by version.
for name in ("python_multipart", "multipart"):
    try:
        __import__(name)
        hiddenimports += collect_submodules(name)
    except ImportError:
        pass

icon_file = {"win32": "assets/icons/icon.ico", "darwin": "assets/icons/icon.icns"}.get(sys.platform)

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=[
        ("templates", "templates"),
        ("static", "static"),
        ("VERSION", "."),
        ("assets/icons", "assets/icons"),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CAIN-Keeper",
    debug=False,
    strip=False,
    upx=False,
    console=True,           # keeps the server log visible; Ctrl+C / close window to stop
    icon=icon_file,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="CAIN-Keeper")

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="CAIN Keeper.app",
        icon="assets/icons/icon.icns",
        bundle_identifier="app.cainkeeper.desktop",
        info_plist={
            "CFBundleShortVersionString": bundle_version,
            "CFBundleVersion": bundle_version,
            "NSHighResolutionCapable": True,
            "LSApplicationCategoryType": "public.app-category.role-playing-games",
        },
    )
