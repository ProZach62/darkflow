#!/usr/bin/env python3
"""Assemble painted sprite frames into a Darkflow sprite sheet and scale
its manifest to match.

Typical use, after generating and background-removing the 14 cells:

    python scripts/sprite-sheet-assemble.py \
        --frames F:/darkflow-sprite-kit/male-scro/painted \
        --manifest public/assets/sprites/male-scro.json \
        --sheet public/assets/sprites/male-scro.png \
        --cell 512

For 16-bit style art add --pixel (nearest-neighbor resize, manifest marked
pixelated so the client draws it unsmoothed) and optionally --colors 32 to
reduce each frame to a palette:

    python scripts/sprite-sheet-assemble.py ... --cell 128 --pixel --colors 32

Frames are matched by pose name anywhere in the file name (01-idle.png,
idle.png, idle_00001_.png all work). Each frame is resized to the cell size
and placed at the cell the manifest already assigns to that pose, so the
frame grid and pose order never have to be typed by hand. The manifest's
frame size, body unit, ground anchor, frame origins, and per-frame anchors
are scaled from the old cell size to the new one, and rigAligned is set to
false so the stage attaches overlays to the anchors rather than rig math.

Requires Pillow. ComfyUI's bundled interpreter has it:

    ComfyUI_windows_portable\\python_embeded\\python.exe scripts\\sprite-sheet-assemble.py ...
"""

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - guidance for the user
    sys.exit("Pillow is required: pip install pillow (or use ComfyUI's python_embeded)")


def scale_point(point, factor):
    out = {"x": round(point["x"] * factor, 2), "y": round(point["y"] * factor, 2)}
    if "r" in point:
        out["r"] = round(point["r"] * factor, 2)
    return out


def quantize_keep_alpha(image, colors):
    """Palette-reduce the RGB channels while keeping the alpha channel intact."""
    alpha = image.getchannel("A")
    rgb = image.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


def find_frame(frames_dir, pose):
    pattern = re.compile(r"(^|[^a-z])" + re.escape(pose) + r"([^a-z]|$)", re.IGNORECASE)
    matches = sorted(p for p in frames_dir.iterdir() if p.suffix.lower() == ".png" and pattern.search(p.stem))
    return matches[0] if matches else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--frames", required=True, help="folder of painted frame PNGs, one per pose")
    parser.add_argument("--manifest", required=True, help="existing manifest to scale (read and overwritten unless --manifest-out)")
    parser.add_argument("--sheet", required=True, help="output sheet PNG")
    parser.add_argument("--cell", type=int, default=512, help="cell size in pixels for the new sheet (default 512)")
    parser.add_argument("--manifest-out", help="write the scaled manifest here instead of overwriting")
    parser.add_argument("--keep-rig-aligned", action="store_true", help="do not flip rigAligned to false")
    parser.add_argument("--pixel", action="store_true", help="pixel art: resize with nearest-neighbor and mark the manifest pixelated so the client draws it without smoothing")
    parser.add_argument("--colors", type=int, default=0, help="with --pixel, quantize each frame to this many colors (alpha preserved)")
    args = parser.parse_args()

    frames_dir = Path(args.frames)
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    old_cell = int(manifest["frameWidth"])
    if int(manifest["frameHeight"]) != old_cell:
        sys.exit("only square cells are supported")
    factor = args.cell / old_cell

    poses = list(manifest["frames"].keys())
    columns = max(int(frame["x"]) // old_cell for frame in manifest["frames"].values()) + 1
    rows = max(int(frame["y"]) // old_cell for frame in manifest["frames"].values()) + 1
    sheet = Image.new("RGBA", (columns * args.cell, rows * args.cell), (0, 0, 0, 0))

    missing = []
    for pose in poses:
        source = find_frame(frames_dir, pose)
        if source is None:
            missing.append(pose)
            continue
        image = Image.open(source).convert("RGBA")
        if image.size != (args.cell, args.cell):
            resample = Image.NEAREST if args.pixel else Image.LANCZOS
            image = image.resize((args.cell, args.cell), resample)
        if args.pixel and args.colors > 0:
            image = quantize_keep_alpha(image, args.colors)
        cell_x = int(manifest["frames"][pose]["x"] * factor)
        cell_y = int(manifest["frames"][pose]["y"] * factor)
        sheet.alpha_composite(image, (cell_x, cell_y))
        print(f"{pose:8s} <- {source.name}")

    if missing:
        print("missing frames (those poses fall back to idle at runtime): " + ", ".join(missing))

    Path(args.sheet).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.sheet, optimize=True)

    scaled = dict(manifest)
    scaled["frameWidth"] = args.cell
    scaled["frameHeight"] = args.cell
    scaled["unit"] = round(manifest["unit"] * factor, 2)
    scaled["anchor"] = scale_point(manifest["anchor"], factor)
    if not args.keep_rig_aligned:
        scaled["rigAligned"] = False
    if args.pixel:
        scaled["pixelated"] = True
    scaled_frames = {}
    for pose, frame in manifest["frames"].items():
        if pose in missing:
            continue
        entry = {"x": int(frame["x"] * factor), "y": int(frame["y"] * factor), "anchors": {}}
        for name, point in (frame.get("anchors") or {}).items():
            entry["anchors"][name] = scale_point(point, factor)
        scaled_frames[pose] = entry
    scaled["frames"] = scaled_frames

    out_path = Path(args.manifest_out) if args.manifest_out else manifest_path
    out_path.write_text(json.dumps(scaled, indent=2) + "\n", encoding="utf-8", newline="\r\n")
    print(f"sheet: {args.sheet} ({sheet.size[0]}x{sheet.size[1]}), manifest: {out_path}")


if __name__ == "__main__":
    main()
