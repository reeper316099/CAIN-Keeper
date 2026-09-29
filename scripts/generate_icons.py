"""
generate_icons.py - regenerate assets/icons/* from the app's favicon design.

Draws the same dark rounded-square + red triangle mark used for the inline
SVG favicon in templates/base.html, at 1024x1024, then derives every format
the packaged apps need:

    icon.ico   Windows executable / installer icon (multi-resolution)
    icon.icns  macOS .app bundle icon
    icon.png   Linux desktop entry / AppImage icon (512x512)

Requires Pillow (not a runtime dependency of the app itself):
    pip install pillow
    python scripts/generate_icons.py
"""

from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw

SIZE = 1024
BG = (17, 18, 21, 255)       # #111215
ACCENT = (229, 72, 77, 255)  # #e5484d
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "icons")


def _inset_point(p: tuple[float, float], centroid: tuple[float, float], dist: float) -> tuple[float, float]:
    dx, dy = centroid[0] - p[0], centroid[1] - p[1]
    length = math.hypot(dx, dy)
    return (p[0] + dx / length * dist, p[1] + dy / length * dist)


def make_base() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(SIZE * 6 / 32)
    d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=BG)

    outer = [(SIZE * 16 / 32, SIZE * 4 / 32), (SIZE * 28 / 32, SIZE * 28 / 32), (SIZE * 4 / 32, SIZE * 28 / 32)]
    centroid = (sum(p[0] for p in outer) / 3, sum(p[1] for p in outer) / 3)
    stroke = SIZE * 3 / 32

    d.polygon(outer, fill=ACCENT)
    # Two nested triangles (fill, then a smaller background-colour fill on
    # top) instead of a stroked line: PIL's polygon line-join at a wide
    # stroke width leaves a visible notch at the apex, this doesn't.
    inner = [_inset_point(p, centroid, stroke * 1.55) for p in outer]
    d.polygon(inner, fill=BG)
    return img


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    base = make_base()
    base.save(os.path.join(OUT_DIR, "icon-1024.png"))

    sizes = [16, 24, 32, 48, 64, 128, 256, 512]
    imgs = {s: base.resize((s, s), Image.LANCZOS) for s in sizes}

    imgs[256].save(os.path.join(OUT_DIR, "icon.ico"), format="ICO",
                    sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    imgs[512].save(os.path.join(OUT_DIR, "icon.png"))
    base.save(os.path.join(OUT_DIR, "icon.icns"), format="ICNS")
    print(f"Wrote icon.ico, icon.icns, icon.png (+ icon-1024.png source) to {OUT_DIR}")


if __name__ == "__main__":
    main()
