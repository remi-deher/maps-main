#!/usr/bin/env python3
"""Genere les trois variantes d'icone iOS 26 (claire / sombre / teintee).

L'icone reprend le motif de l'app : une fleche de navigation (la position
injectee) posee sur un anneau en pointilles (la simulation, par opposition a
une position reelle). Rendu en 4x puis reduit, pour un antialiasing propre
sans dependre d'un moteur vectoriel.

    python ios-app/Scripts/generate_app_icon.py

Ecrit les PNG dans ios-app/Sources/Assets.xcassets/AppIcon.appiconset/.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # supersampling
OUT = Path(__file__).resolve().parents[1] / "Sources/Assets.xcassets/AppIcon.appiconset"

# Meme indigo que AccentColor (Assets.xcassets/AccentColor.colorset).
ACCENT_TOP = (108, 104, 232)
ACCENT_BOTTOM = (70, 66, 190)


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    gradient = Image.new("RGB", (1, size))
    for y in range(size):
        ratio = y / max(size - 1, 1)
        gradient.putpixel(
            (0, y),
            tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3)),
        )
    return gradient.resize((size, size), Image.BICUBIC)


def draw_dashed_ring(draw: ImageDraw.ImageDraw, center: float, radius: float,
                     width: float, color: tuple[int, ...], dashes: int = 18) -> None:
    box = (center - radius, center - radius, center + radius, center + radius)
    step = 360 / dashes
    for index in range(dashes):
        start = index * step
        draw.arc(box, start, start + step * 0.55, fill=color, width=round(width))


def navigation_arrow(center: float, scale: float) -> list[tuple[float, float]]:
    """Fleche facon `location.north.fill`, pointe vers le haut."""
    points = [(0.0, -1.0), (0.78, 0.82), (0.0, 0.34), (-0.78, 0.82)]
    angle = math.radians(24)  # legerement inclinee, comme le curseur de Plans
    rotated = []
    for x, y in points:
        rx = x * math.cos(angle) - y * math.sin(angle)
        ry = x * math.sin(angle) + y * math.cos(angle)
        rotated.append((center + rx * scale, center + ry * scale))
    return rotated


def render(background: Image.Image | None, glyph: tuple[int, int, int, int],
           ring: tuple[int, int, int, int]) -> Image.Image:
    canvas_size = SIZE * SS
    if background is None:
        canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    else:
        canvas = background.resize((canvas_size, canvas_size), Image.BICUBIC).convert("RGBA")

    draw = ImageDraw.Draw(canvas)
    center = canvas_size / 2
    draw_dashed_ring(draw, center, canvas_size * 0.335, canvas_size * 0.028, ring)
    draw.polygon(navigation_arrow(center, canvas_size * 0.185), fill=glyph)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # Claire : fond opaque obligatoire pour l'icone principale.
    light = render(
        vertical_gradient(SIZE, ACCENT_TOP, ACCENT_BOTTOM),
        glyph=(255, 255, 255, 255),
        ring=(255, 255, 255, 140),
    )
    light.convert("RGB").save(OUT / "AppIcon.png")

    # Sombre et teintee : le systeme fournit le fond, on ne livre que le glyphe.
    render(None, glyph=(255, 255, 255, 255), ring=(150, 146, 255, 235)).save(OUT / "AppIcon-Dark.png")
    render(None, glyph=(255, 255, 255, 255), ring=(255, 255, 255, 130)).save(OUT / "AppIcon-Tinted.png")

    print(f"icones ecrites dans {OUT}")


if __name__ == "__main__":
    main()
