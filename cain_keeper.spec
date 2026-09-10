# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for CAIN Keeper.

Build with:   pyinstaller cain_keeper.spec
Result:       dist/CAIN-Keeper/  (one-folder build: the executable plus the
              bundled templates, static files and Python runtime)

The data/ folder is NOT bundled. The app creates it next to the executable on
first launch (see storage.py), so your saves stay outside the build output.
The GitHub release workflows in .github/workflows use this same spec.
"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = (
    collect_submodules("uvicorn")          # protocol/loop implementations are imported by name
    + collect_submodules("anyio")
    + collect_submodules("starlette")
    + collect_submodules("fastapi")
    + collect_submodules("jinja2")
)
# python-multipart exposes different top-level package names by version.
for name in ("python_multipart", "multipart"):
    try:
        __import__(name)
        hiddenimports += collect_submodules(name)
    except ImportError:
        pass

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=[("templates", "templates"), ("static", "static")],
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
    icon=None,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="CAIN-Keeper")
