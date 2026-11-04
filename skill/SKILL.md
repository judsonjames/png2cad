---
name: png2cad
description: Convert a PNG/JPG image of line art or a flat-color logo into CAD and print files, clean DXFs for Onshape, scalable SVGs for Affinity and Illustrator, and 3MF test plates for Bambu/Orca, sized in mm or inches and fitted to nozzle sizes, with verification.
---

# png2cad

Convert a raster image (PNG, JPG) of line art or a flat-color logo into DXF files that import into
an Onshape sketch as clean, extrudable regions, sized in inches and fitted to the printer's nozzle,
plus ready-to-slice 3MF test plates for Bambu Studio and Orca Slicer (and its forks), and scalable
SVG artwork for vector programs (Affinity, Illustrator) and printing on physical products.

## What "done" means

- Every closed area of the artwork is one clickable region in an Onshape sketch
- No crossing or touching edges, no loose ends, no doubled lines
- Sized to fit the requested box (given in mm or inches) without distortion; DXFs have their
  bottom-left at 0,0 in inches, 3MF plates are in millimetres
- Fitted to each requested nozzle: no printed feature thinner than the minimum feature width and
  no gap narrower than the minimum gap width (defaults 1.05 x and 1.0 x the nozzle diameter)
- SVGs are filled shapes in real mm, one named group per color, with neighboring colors sharing
  identical edges, so they scale to any size with no gaps
- `verify_dxf.py` (with `verify_3mf.py` for plates and `verify_svg.py` for SVGs) prints
  `RESULT: PASS` for every file, and the previews drawn from the files have been looked at

## Requirements

Python 3 with numpy, scipy, scikit-image, Pillow and matplotlib. No network access is needed. The
rebuild route also needs a bold sans font (Inter Display Black and DejaVu Sans Bold work). Where
fontconfig is missing or knows no fonts (Windows), `Canvas.font` looks the family up through
matplotlib and otherwise uses Arial Black or Segoe UI Black, printing which; `cv.font()` also takes
a font file path.

With conda:

```bash
conda create -n png2cad --override-channels -c conda-forge python=3.12 numpy scipy scikit-image pillow matplotlib
conda run --no-capture-output -n png2cad python pipeline.py labels.npz out/part --width 5in
```

On Windows, activate the environment or use `conda run`. Calling its `python.exe` directly leaves
its DLL folders off `PATH`, and Python dies silently at the first matrix multiply (exit 127,
`0xc06d007f`).

For 3MF plates that open in Bambu Studio with their filaments loaded, the scripts need Bambu's
preset folder (`machine/`, `process/`, `filament/`). They look in `--bambu-profiles`,
`$BAMBU_PROFILES`, `%APPDATA%\BambuStudio\system\BBL`, `~/.config/BambuStudio/system/BBL` and the
macOS equivalent. Where Bambu Studio is not installed (a cloud workspace), fetch the folder from
Bambu's source:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/bambulab/BambuStudio.git bs
cd bs && git sparse-checkout set --no-cone '/resources/profiles/BBL/machine/*' '/resources/profiles/BBL/process/*' '/resources/profiles/BBL/filament/*'
export BAMBU_PROFILES=$PWD/resources/profiles/BBL
```

Without the presets the plates are plain 3MF: they still open everywhere, but Bambu Studio 2.8.2+
loads geometry only and puts every part on filament 1.

## Setup

The scripts are embedded at the end of this file. If a `scripts/` folder is not already next to
this file, write each embedded file into a working folder `scripts/` (and `examples/`), keeping the
file names, then run everything from inside `scripts/`.

## Step 1: Settle the job

- Target size: a fit box such as "5 in wide", "3 x 3 in" or "76 mm". `--width` / `--height` take
  a unit (`5in`, `5"`, `127mm`, `12.7cm`; a bare number is inches). Keep proportions. If the box
  does not match the artwork's aspect ratio, fit inside it and say so; stretch only on request.
  `--fit art` (default) sizes the artwork; `--fit plate` sizes the whole 3MF plate, border included
  (use it when the plate must fit a slot or a bed)
- Nozzle diameter(s): ask which nozzles will print it (common: 0.2, 0.4, 0.6, 0.8 mm). Default
  0.4 mm. Several can be made in one run, one set of files per nozzle
- Minimum widths: feature = `--feature-factor` x nozzle (default 1.05), gap = `--gap-factor` x
  nozzle (default 1.0). One extrusion line is about one nozzle wide; lines fitted to exactly 1.0 x
  left gaps in Bambu Studio slices, so features get 5% extra. Use 1.5 to 2 for crisper, sturdier
  detail
- Output form:
  - Single DXF (default): every color boundary once, for one sketch
  - Per-color DXFs (`--per-label`): one sketch per color, for multi-color prints
  - 3MF test plates (`--3mf`): one per nozzle, to slice straight away (good for nozzle tests)
    - `--style inset` (default): the design is inlaid flush into the top of a plate
      - One-color art (the truck): a rectangular plate (`base`, 2 mm border, `--margin-mm`) with
        the art inlaid: 2 materials
      - Multi-color art (the shield): one of the design's own colors is the plate body (default
        the color along the art's outer edge, white for the shield; `--body navy` overrides) and
        the other colors are inlaid: one material per color, 3 for the shield, no extra base
    - `--style relief`: base plate with the art raised on top (`--relief-mm`, 0.6)
    - `--style flat`: each color full height, no base (a multi-color tile)
  - SVG (`--svg`): one file for vector programs and product printing, sized to the same box. It
    comes from the unfitted label map, so 3D-print line widening stays out of the artwork.
    `--svg nozzle` writes one per nozzle from the fitted maps instead; `--svg both` writes each
    - For an SVG alone, skip the nozzle fit: `labels_to_svg.py labels.npz logo.svg --width 76mm`
- Inset depth: default 10 layers of half the nozzle (0.4 mm nozzle: 0.2 mm layers, 2.0 mm deep;
  0.2 mm: 1.0 mm; 0.6 mm: 3.0 mm; 0.8 mm: 4.0 mm). Override with `--inset-mm 1.6` (a fixed depth
  for every nozzle) or `--inset-layers 8` and/or `--layer-mm 0.16`. A depth that is not a whole
  number of layers prints a warning. `--base-mm` (1.2) is the solid plate under the inset; it is
  rounded to whole layers with a note
- Printer (Bambu project): `--printer` (default `Bambu Lab X1 Carbon`; also X1, X1E, P1S, P1P, A1,
  A1 mini, P2S). Each plate carries that printer with the nozzle in its name, the Bambu Standard
  process whose layer is half the nozzle (0.2: 0.10 mm, 0.4: 0.20 mm, 0.6: 0.30 mm, 0.8: 0.40 mm)
  and one Bambu PLA Basic per part in the part's color. Dual-nozzle printers (H2D) are not supported
- Materials: ask how many filaments the plate should load with, if the person cares. Every part is
  one material, assigned filaments 1..N in the file. `--materials N` makes the run fail unless the
  plate comes out at exactly N (truck 2, shield 3). To get fewer, merge colors in the label map or
  pick another style

## Step 2: Choose the route

Look at the image at 4x (`measure.py --zoom` or an enlarged crop) before choosing.

| Route | Use when | Command |
|---|---|---|
| Mask | One foreground color on a plain background: line art, silhouettes, outlines (the truck) | `make_labels.py --mode mask` |
| Colors | Several flat colors, the logo at least ~400 px across, lettering at least ~20 px tall, background a color the logo does not use | `make_labels.py --mode colors` |
| Rebuild | A small or blurry logo made of simple shapes and text, or a logo that shares a color with its background (the shield on a navy poster) | write a script with `rebuild_helpers.py`, modelled on `examples/shield_rebuild.py` |

Signs the colors route is the wrong choice: background streaks or texture show up as parts, the
logo's own background-colored areas merge into the background, lettering comes out lumpy, thin
color fringes (drop shadows, anti-aliasing) become slivers. Switch to rebuild.

Crop the image to the artwork first (`convert in.png -crop WxH+X+Y +repage crop.png`), with a few
pixels of plain background around it.

## Step 3a: Mask and colors routes

```bash
# line art, 5 in wide
python make_labels.py art.png labels.npz --mode mask --width 5in
# flat-color logo inside 76 x 76 mm; list the background color first or let it come from the border
python make_labels.py logo.png labels.npz --mode colors --palette "#ffffff,#d6222c,#14204a" --width 76mm --height 76mm
```

- `--fg`/`--bg` force colors in mask mode when auto-detection picks wrong (check the printed labels)
- `--colors N` runs k-means when there is no palette; prefer an explicit palette sampled from the image
- `--speck-mm` (default 0.15) merges noise specks; line and gap widths are not changed here
- `--grid-in` (default 0.0005 in) is the label grid; larger is faster, smaller is smoother

## Step 3b: Rebuild route

1. Measure in source pixels with `measure.py`:
   - Color runs along rows and columns through each shape give edge positions and stroke widths
     (`--rows`, `--cols`). Find the symmetry axis from matching runs on both sides
   - For slanted edges, take the same edge on several rows and fit the slope
   - For each line of text, `--letters x0:x1:y0:y1:K` gives every letter's column span and the
     line's row span. Letters that touch (VA, AV) come back merged; split them by eye
2. Write a script on `Canvas` (see `rebuild_helpers.py` docstring and the worked example):
   - Set `src_box` to the artwork's outer edges so the part fills the requested width
   - Build shapes with `poly`, `rect`, `ellipse`, offsets with `grow`, rounded panels with
     `round_corners`; combine with `&`, `|`, `~`
   - Set text with `text(chars, columns, row0, row1, font)`: each glyph is stretched to its measured
     box, which keeps the source's spacing and weight
   - Trace organic bits (a state outline, an icon) with `trace_from_source`; a 1 px outline becomes
     a filled silhouette rebuilt as an even ring (`fill=True, line_src_px=1.2`)
   - Make the colors tile the footprint: compute the last color as `footprint & ~others`
   - `save(path, [("background", None), (name, "#hex"), ...], [mask, ...])`; later masks win
3. Render a preview (Step 4 writes one per nozzle) and compare it side by side with the source at
   the same scale. Fix measurements until shapes, ring widths and letter positions match

## Step 4: Fit to the nozzle(s), export, verify

```bash
python pipeline.py labels.npz out/part --nozzle-mm 0.2,0.4,0.6,0.8 --width 3in --height 3in --per-label
# test plates: truck, 2 materials; shield, 3 materials, 76 mm wide, 1.6 mm inset at every nozzle
python pipeline.py truck_labels.npz out/truck --nozzle-mm 0.2,0.4,0.6,0.8 --width 5in --3mf --materials 2
python pipeline.py shield_labels.npz out/shield --nozzle-mm 0.4 --width 76mm --3mf --materials 3 --inset-mm 1.6
# everything at once: DXF and plate per nozzle, plus one scalable SVG
python pipeline.py truck_labels.npz out/truck --nozzle-mm 0.4 --width 5in --3mf --materials 2 --svg
```

Add `--3mf` for test plates and `--svg` for vector artwork. For each nozzle N this writes
`out/part_nN.dxf` (+ `out/part_nN_<color>.dxf`), a preview `out/part_nN.png`, with `--3mf` a plate
`out/part_nN.3mf` and its top-down preview `out/part_nN_3mf.png`, the fitted label map, a fit report
`out/part_nN_fit.json`, and one table for all nozzles in `out/part_summary.md`. `--svg` adds
`out/part.svg`, its preview `out/part_svg.png` and a row in the summary.

The SVG (`labels_to_svg.py`): filled shapes rather than outlines, so a design program can recolor
and scale them. It reuses the DXF's boundary chains: each chain is fitted once with cubic Beziers,
then shared by the two colors on its sides, which is why colors meet exactly. Sharp corners are
rebuilt where their two sides meet and straight runs stay lines. Each color is a group named after its label (these open
as layers), each connected area one path with its holes cut out (`fill-rule="evenodd"`). `width` and
`height` are in mm with a viewBox in mm, so the art opens at its real size. The background label
is left out and stays transparent. `--tol-mm` (0.02) trades nodes for closeness to the trace,
`--corner-deg` (40) sets what counts as a corner, and `--backdrop "#hex"` adds a background rectangle.
`verify_svg.py` checks the structure (filled paths only: no images, text, strokes, styles or
transforms), closed subpaths, size, crossings, areas per color against the label map's regions, the
largest drift from the label map (limit 0.1 mm), overlap between colors, and draws the preview
from the file's own paths.

The 3MF (`labels_to_3mf.py`, `mesh3mf.py`): millimetres, one object made of named parts, each
tagged with its display color and assigned a filament (part k on filament k) in
`Metadata/model_settings.config`, the Bambu Studio / Orca convention. With Bambu presets available
(`bambu_profile.py`) the file is also a Bambu Studio project: `Metadata/project_settings.config`
holds the printer, process and filament settings resolved from Bambu's own presets (inherits and
includes, the way Bambu Studio does), the Application tag says `BambuStudio-02.08.00.00` (Bambu
reads project settings only from files tagged that way; keep the version at or below the installed
one, `--bambu-version`), and the plate is centred on the bed. Bambu Studio then opens it with N
filaments in the plate's colors and each part on its filament.
Every part is a closed, consistently oriented mesh. `verify_3mf.py` checks that (open edges,
zero-area and folded triangles), the filament numbers (1..N, one per part, `--materials`), that the
inlaid top is flush and fully covered, the parts' top areas against the label map (within 2%), the
art's and plate's size, and draws the preview from the file's own triangles.

What the fit does (`nozzle.py`):
- Thin features: a thin spot whose centreline is longer than 2 x the minimum is a real line and is
  widened around its centreline. A shorter one bordered mostly by another color (a sharp inner
  corner of a letter) is merged into that color, since widening it would eat the letter. Short
  bits bordered by background are widened. `--thin-features remove` merges every thin spot instead
- Narrow gaps (`--gaps fill`, the default): closed by rolling a nozzle-sized disk along the
  features, which gives smooth, rounded fills and no trapped bubbles. This is what the slicer would
  do to a gap that narrow anyway. `--gaps open` first tries to push features back to keep the gap,
  then closes what still conflicts; it is slower and usually messier
- A light smoothing pass, then the checks run again, so the result is clean and within limits
- If widened tips push the art past the box, the source is scaled down slightly and refitted

Reading the summary:
- `Thin features left` and `Narrow gaps left` must be 0
- `Art changed` is the share of the artwork's area the fit moved. Above roughly 25%, the detail is
  finer than that nozzle at that size (the 5 in truck at 1.05 x lines: 0.4 mm 8%, 0.6 mm 27%, 0.8 mm 61%). Say so,
  and suggest printing larger or using a smaller nozzle for a faithful result

`labels_to_dxf.py`, `labels_to_3mf.py`, `labels_to_svg.py` and the verifiers can also be run on
their own:

```bash
python labels_to_dxf.py labels.npz part.dxf --per-label part
python verify_dxf.py part.dxf --labels labels.npz --nozzle-mm 0.4 --width-in 3 --height-in 3 --preview preview.png
python labels_to_3mf.py labels_n0.4.npz part_n0.4.3mf --nozzle-mm 0.4 --materials 3
python verify_3mf.py part_n0.4.3mf --labels labels_n0.4.npz --materials 3 --preview part_n0.4_3mf.png
python labels_to_svg.py labels.npz logo.svg --width 76mm
python verify_svg.py logo.svg --labels labels.npz --width 76mm --preview logo_svg.png
```

## Step 5: Check before delivering

- Every row of the summary says `PASS` (and `3MF` and the SVG table say `PASS` when those were
  made); each per-color file was verified too (the pipeline does it)
- Hard failures: crossings, dangling ends, size over the box, faces not matching the label map's
  regions (rechecked at 3x resolution automatically before failing)
- Open each preview and look at it. It is drawn from the DXF itself, so it shows what Onshape gets.
  Look hardest at lettering and sharp corners at the largest nozzle

## Step 6: Deliver

- Send the DXF(s), previews and the summary table. Say the size, the nozzle each file is for, the
  face count, the art-changed figure, and anything changed from the source (substituted font,
  dropped hairline details, merged double lines, filled-in tiny text)
- Name files by nozzle (`part_n0.4.dxf`, `part_n0.4.3mf`) so the right one goes with the right printer
- Slicer steps for a plate: open the `.3mf` in Bambu Studio normally (double-click, drag in or
  File > Open). A Bambu-project plate loads with the printer, process and N filaments set, each
  part on its filament; check the printer matches the one that will print it. A plain plate
  (no presets were found) gives "invalid config, load geometry data only" in Bambu Studio 2.8.2+;
  use File > Import (Ctrl+I) instead, which adds filament slots up to the highest one the parts
  use, then set the slot colors. Slice with the nozzle and layer height in the summary
- Tiny dark wedges where two lines meet at a sharp angle are expected: the tip of the gap between
  them narrows below one line width and no slicer fills it. They shrink with a larger print or a
  smaller nozzle
- Say plainly whether the slicer import was tried
- Onshape steps: in a sketch, Insert DXF/DWG, choose inches. Single file: one sketch, then select
  regions by color and extrude. Per-color files: one sketch per file (putting them in one sketch
  stacks duplicate edges)
- SVG steps: open or place the `.svg` in Affinity or Illustrator. Each color is a layer of filled
  shapes in RGB, so set final print colors there. White art on a transparent background (the
  truck) is invisible on a white page; add `--backdrop "#hex"` or view it on a dark layer. Affinity
  reports the size in points at 72 DPI: 215.4 pt is 76 mm
- Some viewers can show hairlines between colors where they anti-alias two shapes that share an
  edge. They are not in the file. If a printer asks for trapping, add it in the design program
- An SVG is only as detailed as its source. It scales cleanly, but it cannot add detail a small
  image lacks; rebuild small logos first (Step 3b) and say which font stood in
- Offer: a higher-resolution original for a retrace; other nozzles or larger factors

## Lessons that shaped this method

- Smoothing each outline separately (splines, Catmull-Rom) makes neighboring outlines cross where
  lines run close. Contours from a single label map never cross; keep smoothing small and check
- Merging per-color outlines into one sketch doubles every shared edge with near-duplicates.
  The single-file export walks label boundaries once, between junctions, with exact shared endpoints
- Strokes thinner than the nozzle are also where outlines pinch together; fix widths before tracing
- Smoothing after speck cleanup can pinch off new pinholes; clean up after smoothing
- An R12 POLYLINE DXF is read by every importer; `$INSUNITS` 1 marks inches, but Onshape still asks
- A 1-raster-pixel face can appear in the face check where drawn lines pinch at a sharp vertex;
  the checker ignores faces under 3x3 raster pixels
- Logo text under ~20 px tall cannot be traced into clean letters; rebuild it with a matching font
- Thin-ness is tested by morphological opening with a disk of the minimum width, not by skeleton
  width percentiles: a round cap exactly the minimum is fine, and stroke tips no longer read as thin
- Reassigning narrow gaps pixel by pixel leaves ragged edges and bubbles; closing with a
  nozzle-sized disk fills them cleanly
- Widening every thin spot destroys letters at large nozzles (the sharp inner corners of an N grow
  into its strokes); widen lines, merge short corner tips that border another color
- Fitting on a coarser grid is much faster, but striding the source by more than 2 breaks thin
  lines into dashes that then get filled as gaps (the 0.8 mm truck went from 51% to 88% changed)
- 3MF meshing: points that are nearly in a line in memory become exactly in a line when written at
  0.0001 mm, giving zero-area triangles (three letter bottoms on one baseline). Snapping before
  triangulating made hole bridging misfire; the fix is to triangulate unrounded and remove slivers
  judged on the rounded coordinates, by flipping them with the triangle across their long edge
- A top-down preview painted lowest surface first is exact for plates; matplotlib's 3D view sorts
  whole parts and hid the raised art behind the base
- Overlapping triangles cancel in area and volume totals, so a mesh can pass "watertight" and
  still be folded. The check now looks for triangles facing the wrong way on each flat face
- Hole bridging: when several holes bridge to the same outline vertex, the vertex is duplicated;
  the next bridge must go to the copy whose corner contains it, or the outline folds over itself
- Outlines traced from pixels have many edges at exactly equal heights, so a horizontal bridge ray
  hits vertices exactly. Triangulating in a slightly rotated frame (same points, so the geometry
  is unchanged) removed the last failures: 144 random maps, 432 parts, 0 failures
- Coordinates are written at 6 decimals and slivers are judged at that precision; at 4 decimals
  the sliver flips themselves created folds on the 0.2 mm truck
- Bambu Studio 2.8.2 rejects the settings of any 3MF whose config has no nozzle_diameter and no
  Bambu printer_model ("invalid config, load geometry data only"). It decides whether to add
  filament slots before that check, so Open leaves every part on filament 1; Import adds slots
  but not colors. A project_settings.config naming a Bambu printer, in a file tagged
  `BambuStudio-<version>`, passes (Plater.cpp `check_project_config`, `is_bbl_vendor_config`)
- Lines fitted to exactly one nozzle width left gaps in the Bambu slice; 1.05 x fixed nearly all
- SVG colors come from chains, not per-color outlines: fitting each color's outline alone would
  leave slivers and overlaps along every shared edge. Fit each chain once and reuse it, reversed,
  for the color on its other side
- At a pinch point, where a color touches itself at a corner, a loop must take the sharpest left
  turn and close when that turn leads back to its start; otherwise two areas merge into one path
- Decide outline or hole from the traced points, not the fitted curve: a loose fit can turn a tiny
  area inside out. Short chains get a tighter tolerance for the same reason
- Fitted curves can cross where two boundaries pass within a cell of each other even though the
  trace does not; refit the chains involved at a tighter tolerance, as the DXF does
- A raster fill includes its edge pixels, which reads as area error on thin line art; compare
  areas from the path geometry and keep rasters for locating drift
- Passing the drift check is not the same as looking right. Inside a 0.02 mm tolerance, edges that
  should be straight bowed and corners went soft, which only showed at 1500% in Affinity. Read end
  tangents from the straight run past the rounded corner points, rebuild corners where the two
  sides meet, and use a wide symmetric tangent at splits so the pixel staircase cannot tilt it
- `TextPath.to_polygons` flattens curves to a fixed tolerance, so letters made at size 100 are
  faceted long before tracing. Make them at size 4000 and scale down
- Compare geometry at a resolution finer than the file, and say what a crossing means. Rounding to
  0.001 mm turned near-touching lines into false crossings; a filled shape only needs lines that
  pass 0.001 mm beyond each other flagged, since any real sliver also fails overlap and drift

## Embedded files

Write each file below to the path in its heading (relative to a working folder), unchanged.

### `scripts/dxf_io.py`

```python
"""Shared helpers: R12 DXF read/write, label-map storage, crossing checks.

Curves are (points, closed) pairs. Points are an (N, 2) array in inches, Y up, origin at the
bottom-left of the artwork. R12 POLYLINE is used because every CAD importer reads it.
"""
import json
import numpy as np


def write_dxf(path, curves, layer="0"):
    """Write curves to an R12 DXF in inches. curves: list of (Nx2 array, closed: bool)."""
    pts_all = np.vstack([p for p, _ in curves]) if curves else np.zeros((1, 2))
    lo, hi = pts_all.min(0), pts_all.max(0)
    out = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009",
           "9", "$INSUNITS", "70", "1",
           "9", "$EXTMIN", "10", f"{lo[0]:.4f}", "20", f"{lo[1]:.4f}",
           "9", "$EXTMAX", "10", f"{hi[0]:.4f}", "20", f"{hi[1]:.4f}",
           "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"]
    for pts, closed in curves:
        out += ["0", "POLYLINE", "8", layer, "66", "1", "70", "1" if closed else "0",
                "10", "0", "20", "0", "30", "0"]
        for x, y in pts:
            out += ["0", "VERTEX", "8", layer, "10", f"{x:.5f}", "20", f"{y:.5f}", "30", "0"]
        out += ["0", "SEQEND", "8", layer]
    out += ["0", "ENDSEC", "0", "EOF"]
    with open(path, "w", newline="\r\n") as f:
        f.write("\n".join(out) + "\n")


def read_dxf(path):
    """Read POLYLINE curves back from an R12 DXF written by write_dxf (or any simple R12 file)."""
    lines = [s.strip() for s in open(path).read().split("\n")]
    curves, cur, in_header, closed, x = [], None, True, False, 0.0
    for code, val in zip(lines[0::2], lines[1::2]):
        if code == "0" and val == "POLYLINE":
            cur, in_header, closed = [], True, False
        elif code == "70" and cur is not None and in_header:
            closed = bool(int(val) & 1)
        elif code == "0" and val == "VERTEX":
            in_header = False
        elif code == "0" and val == "SEQEND" and cur is not None:
            curves.append((np.array(cur, float), closed))
            cur = None
        elif cur is not None and not in_header and code == "10":
            x = float(val)
        elif cur is not None and not in_header and code == "20":
            cur.append((x, float(val)))
    return curves


def parse_length(text, default_unit="in"):
    """A length with optional unit -> inches. Accepts 5, 5in, 5", 127mm, 12.7cm (case-insensitive).
    Returns None for None or empty text."""
    if text is None or str(text).strip() == "":
        return None
    t = str(text).strip().lower().replace(" ", "")
    for unit, factor in (("mm", 1 / 25.4), ("cm", 1 / 2.54), ("in", 1.0), ('"', 1.0)):
        if t.endswith(unit):
            return float(t[: -len(unit)]) * factor
    return float(t) * {"in": 1.0, "mm": 1 / 25.4, "cm": 1 / 2.54}[default_unit]


def fmt_size(w_in, h_in):
    """'5.000 x 1.523 in (127.0 x 38.7 mm)'"""
    return f"{w_in:.3f} x {h_in:.3f} in ({w_in * 25.4:.1f} x {h_in * 25.4:.1f} mm)"


def save_labels(path, labels, inch_per_px, names, colors):
    """labels: 2D uint8 array, row 0 at the top. Label 0 is background (not part of the part).
    inch_per_px: size of one grid cell. names/colors: one entry per label value."""
    np.savez_compressed(path, labels=labels.astype(np.uint8), inch_per_px=float(inch_per_px),
                        meta=json.dumps({"names": list(names), "colors": [list(map(int, c)) for c in colors]}))


def load_labels(path):
    d = np.load(path, allow_pickle=False)
    meta = json.loads(str(d["meta"]))
    return d["labels"], float(d["inch_per_px"]), meta["names"], [tuple(c) for c in meta["colors"]]


def segments(curves):
    """All segments as rows (x0, y0, x1, y1) plus the index of the curve each came from."""
    segs, owner = [], []
    for ci, (p, closed) in enumerate(curves):
        q = np.vstack([p, p[:1]]) if closed else p
        if len(q) < 2:
            continue
        segs.append(np.hstack([q[:-1], q[1:]]))
        owner += [ci] * (len(q) - 1)
    return np.vstack(segs), np.array(owner)


def find_crossings(curves, eps=1e-9):
    """Return a list of (curve_i, curve_j, x, y) where two segments touch or cross.
    Segments that share an endpoint (consecutive segments, or curves meeting at a junction) are allowed."""
    S, own = segments(curves)
    lo = np.minimum(S[:, :2], S[:, 2:])
    hi = np.maximum(S[:, :2], S[:, 2:])
    order = np.argsort(lo[:, 0])

    def orient(o, p, q):
        return (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])

    hits = []
    for n, i in enumerate(order):
        for j in order[n + 1:]:
            if lo[j, 0] > hi[i, 0]:
                break
            if lo[j, 1] > hi[i, 1] or hi[j, 1] < lo[i, 1]:
                continue
            a, b, c, d = S[i, :2], S[i, 2:], S[j, :2], S[j, 2:]
            if min(np.abs(a - c).sum(), np.abs(a - d).sum(), np.abs(b - c).sum(), np.abs(b - d).sum()) < eps:
                continue
            if orient(c, d, a) * orient(c, d, b) <= 0 and orient(a, b, c) * orient(a, b, d) <= 0:
                hits.append((int(own[i]), int(own[j]), float(a[0]), float(a[1])))
    return hits
```

### `scripts/make_labels.py`

```python
"""Turn a raster image into a high-resolution label map sized in inches.

Two modes:
  mask    one foreground color on a background (line art, silhouettes)
  colors  several flat colors (logos). Give --palette "#ffffff,#d6222c,#14204a" or --colors N.

Output: labels.npz for pipeline.py (nozzle fitting, export, checks). Label 0 is the background,
which is not part of the part. Line and gap widths are NOT adjusted here; pipeline.py fits them to
the nozzle. The map is cropped to the artwork and scaled to fit --width-in x --height-in
without distortion (give either or both).

Sizes take a unit: 5in, 127mm, 12.7cm (a bare number is inches). --width-in/--height-in still work.

Examples:
  python make_labels.py truck.png labels.npz --mode mask --width 5in
  python make_labels.py logo.png labels.npz --mode colors --palette "#fff,#d6222c,#14204a" --width 76mm --height 76mm
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from skimage import filters, transform

from dxf_io import save_labels, parse_length, fmt_size


def hex_to_rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def border_pixels(img):
    return np.vstack([img[:2].reshape(-1, 3), img[-2:].reshape(-1, 3),
                      img[:, :2].reshape(-1, 3), img[:, -2:].reshape(-1, 3)])


def fit_scale(w_src, h_src, width_in, height_in):
    """Inches per source pixel so the artwork fits inside the box without distortion."""
    options = []
    if width_in:
        options.append(width_in / w_src)
    if height_in:
        options.append(height_in / h_src)
    if not options:
        raise SystemExit("give --width and/or --height (for example 5in or 127mm)")
    return min(options)


def content_box(fg, margin=1):
    ys, xs = np.nonzero(fg)
    if len(xs) == 0:
        raise SystemExit("no artwork found; check --fg / --palette")
    return (max(xs.min() - margin, 0), max(ys.min() - margin, 0),
            min(xs.max() + margin + 1, fg.shape[1]), min(ys.max() + margin + 1, fg.shape[0]))


def speck_cells(a):
    """Areas smaller than a --speck-mm square are noise (anti-aliasing, JPEG dust)."""
    return (a.speck_mm / 25.4 / a.grid_in) ** 2


def remove_specks(labels, min_area_px):
    """Merge connected regions smaller than min_area_px into their surroundings."""
    out = labels.copy()
    bad = np.zeros(labels.shape, bool)
    for v in np.unique(labels):
        comp, n = ndimage.label(labels == v)
        if n == 0:
            continue
        sizes = ndimage.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
        small = np.nonzero(sizes < min_area_px)[0] + 1
        if len(small):
            bad |= np.isin(comp, small)
    if bad.any():
        _, (iy, ix) = ndimage.distance_transform_edt(bad, return_indices=True)
        out[bad] = labels[iy[bad], ix[bad]]
    return out


def mask_mode(img, a):
    bg = np.median(border_pixels(img), axis=0) if a.bg == "auto" else hex_to_rgb(a.bg)
    if a.fg == "auto":
        d = np.linalg.norm(img - bg, axis=-1)
        fg = np.median(img[d > 0.5 * d.max()], axis=0)
    else:
        fg = hex_to_rgb(a.fg)
    axis = fg - bg
    f = np.clip(((img - bg) @ axis) / (axis @ axis), 0, 1)   # 0 = background, 1 = foreground, AA in between
    x0, y0, x1, y1 = content_box(f > 0.5)
    k_src = fit_scale(x1 - x0, y1 - y0, a.width_in, a.height_in)
    up = k_src / a.grid_in
    big = transform.rescale(f[y0:y1, x0:x1], up, order=3, anti_aliasing=False)
    big = filters.gaussian(big, sigma=0.35 * up)
    b = big > 0.5
    lab = (filters.gaussian(b.astype(float), sigma=1.5) > 0.5).astype(np.uint8)
    lab = remove_specks(lab, speck_cells(a))            # after smoothing, which can pinch off pinholes
    names = ["background", "foreground"]
    colors = [tuple(bg.astype(int)), tuple(fg.astype(int))]
    return lab, names, colors


def colors_mode(img, a):
    if a.palette:
        pal = np.array([hex_to_rgb(h) for h in a.palette.split(",")])
    else:
        px = img.reshape(-1, 3)[:: max(1, img.size // 3 // 200000)]
        pal, _ = kmeans2(px, a.colors, minit="++", seed=1)
    # background = the palette color most common on the border
    border = border_pixels(img)
    bidx = np.argmin(((border[:, None, :] - pal[None]) ** 2).sum(-1), axis=1)
    bgi = np.bincount(bidx, minlength=len(pal)).argmax()
    if a.bg != "auto":
        bgi = int(np.argmin(((pal - hex_to_rgb(a.bg)) ** 2).sum(-1)))
    order = [bgi] + [i for i in range(len(pal)) if i != bgi]
    pal = pal[order]
    d2 = ((img[..., None, :] - pal) ** 2).sum(-1)
    pd = np.sqrt(((pal[:, None] - pal[None]) ** 2).sum(-1))
    sigma = 0.35 * pd[pd > 0].min()
    w = np.exp(-(d2 - d2.min(-1, keepdims=True)) / (2 * sigma ** 2))
    w /= w.sum(-1, keepdims=True)
    x0, y0, x1, y1 = content_box(w[..., 0] < 0.5)
    k_src = fit_scale(x1 - x0, y1 - y0, a.width_in, a.height_in)
    up = k_src / a.grid_in
    best = best_i = None
    for i in range(len(pal)):   # upscale each class weight and keep the argmax, one class at a time
        big = filters.gaussian(transform.rescale(w[y0:y1, x0:x1, i], up, order=3), sigma=0.35 * up)
        if best is None:
            best, best_i = big.astype(np.float32), np.zeros(big.shape, np.uint8)
        else:
            m = big > best
            best[m], best_i[m] = big[m], i
    lab = remove_specks(best_i, speck_cells(a))
    names = ["background"] + [f"color{i}" for i in range(1, len(pal))]
    return lab, names, [tuple(c.astype(int)) for c in pal]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image")
    p.add_argument("out", help="labels .npz")
    p.add_argument("--mode", choices=["mask", "colors"], required=True)
    p.add_argument("--width", help="target width with unit: 5in, 127mm, 12.7cm")
    p.add_argument("--height", help="target height with unit")
    p.add_argument("--width-in", type=float, help=argparse.SUPPRESS)
    p.add_argument("--height-in", type=float, help=argparse.SUPPRESS)
    p.add_argument("--grid-in", type=float, default=0.0005, help="label grid cell size in inches")
    p.add_argument("--speck-mm", type=float, default=0.15, help="merge specks smaller than this square")
    p.add_argument("--bg", default="auto", help="background color (#hex) or auto (from the image border)")
    p.add_argument("--fg", default="auto", help="mask mode: foreground color (#hex) or auto")
    p.add_argument("--palette", help="colors mode: comma-separated #hex colors, background included")
    p.add_argument("--colors", type=int, default=3, help="colors mode without --palette: k-means count")
    a = p.parse_args()
    a.width_in = parse_length(a.width) or a.width_in
    a.height_in = parse_length(a.height) or a.height_in
    img = np.array(Image.open(a.image).convert("RGB")).astype(float)
    lab, names, colors = (mask_mode if a.mode == "mask" else colors_mode)(img, a)
    save_labels(a.out, lab, a.grid_in, names, colors)
    h, w = lab.shape
    print(f"labels {w}x{h} cells = {fmt_size(w * a.grid_in, h * a.grid_in)}; "
          f"labels: {', '.join(f'{i}={n} #{bytes(map(int, c)).hex()}' for i, (n, c) in enumerate(zip(names, colors)))}")


if __name__ == "__main__":
    main()
```

### `scripts/nozzle.py`

```python
"""Fit a label map to a nozzle: no printed feature thinner than the nozzle can lay down, no gap
narrower than it can leave open.

Terms (all on the label grid):
  feature  any non-background label. In a multi-color print every color is a feature of its own
           filament, so a navy strip between white and red must be at least one line wide too
  gap      background (label 0): empty space between printed features, and holes inside them
  thin     the part of a region that a disk of the minimum width cannot reach (morphological
           opening). A round cap exactly the minimum width is not thin; a hairline or a pinched
           gap is. Tiny bits at sharp convex corners are ignored (area under 0.5 x width squared)

Defaults: minimum feature = 1.05 x nozzle, minimum gap = 1.0 x nozzle. One extrusion line is
about one nozzle wide; a line exactly one nozzle wide left gaps in Bambu Studio slices, so features
get 5% extra. Raise the factors (1.5 to 2) for crisper, stronger detail.

Gap handling:
  open   first try to widen each narrow gap by pushing the neighboring features back (keeps the
         design's separations where there is room), then close what still conflicts
  fill   close every narrow gap into its neighbors right away (what the slicer would do anyway;
         never makes features thinner). Closing rolls a nozzle-sized disk along the features, so
         filled areas have smooth, rounded edges
Thin features (thin_features="widen", the default): a thin spot whose centreline is longer than
2 x the minimum width is a real line and is widened around its centreline. A shorter one bordered
mostly by another color (a sharp inner corner of a letter) is merged into that color, since
widening it would eat the letter; one bordered by background is widened.
thin_features="remove" merges every thin spot instead.

Where a feature and its neighboring gap cannot both reach their minimums (detail finer than the
nozzle), the fit runs a few rounds and then reports the spots that still conflict.
"""
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize


def opened(mask, r):
    """Morphological opening with a disk of radius r (grid cells), via distance transforms."""
    if r <= 0:
        return mask
    core = ndimage.distance_transform_edt(mask) > r
    return ndimage.distance_transform_edt(~core) <= r


def thin_spots(mask, width_px, min_area_frac=0.5):
    """Pixels of mask in parts narrower than width_px, as a boolean mask, ignoring corner crumbs."""
    t = mask & ~opened(mask, 0.98 * width_px / 2.0)
    if not t.any():
        return t
    comp, n = ndimage.label(t)
    sizes = np.bincount(comp.ravel(), minlength=n + 1)[1:]
    keep = np.nonzero(sizes >= min_area_frac * width_px ** 2)[0] + 1
    return np.isin(comp, keep)


def spot_report(mask_thin, g, limit=5):
    """Summaries of thin spots: count, total area mm2, and the largest few centroids (inches, Y up)."""
    comp, n = ndimage.label(mask_thin)
    if n == 0:
        return {"count": 0, "area_mm2": 0.0, "where_in": []}
    sizes = np.bincount(comp.ravel(), minlength=n + 1)[1:]
    cents = ndimage.center_of_mass(mask_thin, comp, index=np.arange(1, n + 1))
    H = mask_thin.shape[0]
    order = np.argsort(-sizes)[:limit]
    where = [(round(cents[i][1] * g, 3), round((H - cents[i][0]) * g, 3)) for i in order]
    return {"count": int(n), "area_mm2": float(sizes.sum() * (g * 25.4) ** 2), "where_in": where}


def widen(lab, v, thin, width_px):
    """Grow label v around its centreline where it is thin, to width_px wide.
    Works in a window around each thin spot, so large maps stay fast."""
    comp, n = ndimage.label(thin)
    if n == 0:
        return lab
    out = lab.copy()
    m = int(2 * width_px) + 4
    H, W = lab.shape
    for sl in ndimage.find_objects(comp):
        ys = slice(max(sl[0].start - m, 0), min(sl[0].stop + m, H))
        xs = slice(max(sl[1].start - m, 0), min(sl[1].stop + m, W))
        sub, t = out[ys, xs], thin[ys, xs]
        skel = skeletonize(sub == v) & (ndimage.distance_transform_edt(~t) <= width_px)
        if skel.any():
            sub[ndimage.distance_transform_edt(~skel) <= width_px / 2.0] = v
    return out


def reassign(lab, region):
    """Give each pixel in region the label of the nearest pixel outside it."""
    if not region.any():
        return lab
    _, (iy, ix) = ndimage.distance_transform_edt(region, return_indices=True)
    out = lab.copy()
    out[region] = lab[iy[region], ix[region]]
    return out


def split_thin(mask, thin, width_px):
    """Split thin spots into lines (centreline longer than 2 x width: always widened) and short bits
    (sharp-corner tips, specks: see bits_by_neighbour)."""
    comp, n = ndimage.label(thin)
    if n == 0:
        return thin, thin
    skel = skeletonize(mask) & thin
    length = np.bincount(comp[skel], minlength=n + 1)
    is_line = length >= 2 * width_px
    is_line[0] = False
    lines = is_line[comp]
    return lines, thin & ~lines


def bits_by_neighbour(lab, v, bits, ring_px=3):
    """Short thin bits mostly bordered by another feature color would eat it if widened: merge those.
    Bits bordered mostly by background are widened like lines (the gap check guards the background)."""
    comp, n = ndimage.label(bits)
    if n == 0:
        return bits, bits
    eat = np.zeros(bits.shape, bool)
    H, W = lab.shape
    for i, sl in enumerate(ndimage.find_objects(comp), start=1):
        ys = slice(max(sl[0].start - ring_px, 0), min(sl[0].stop + ring_px, H))
        xs = slice(max(sl[1].start - ring_px, 0), min(sl[1].stop + ring_px, W))
        c = comp[ys, xs] == i
        ring = (ndimage.distance_transform_edt(~c) <= ring_px) & ~c
        around = lab[ys, xs][ring]
        around = around[around != v]
        if len(around) and np.count_nonzero(around) > 0.5 * len(around):
            eat[ys, xs] |= c
    return eat, bits & ~eat


def fix_features(out, labels, wf, thin_features):
    """One pass over every feature label. Returns (new map, whether anything changed)."""
    changed = False
    for v in labels:
        m = out == v
        t = thin_spots(m, wf)
        if not t.any():
            continue
        changed = True
        if thin_features == "remove":
            out = reassign(out, t)
            continue
        lines, bits = split_thin(m, t, wf)
        eat, keep = bits_by_neighbour(out, v, bits)
        out = reassign(out, eat)
        out = widen(out, v, lines | keep, wf)
    return out, changed


def close_gaps(lab, width_px):
    """Fill every gap narrower than width_px (morphological closing of all features together), giving
    each filled pixel to the nearest feature. Edges come out smooth and no bubbles are left behind."""
    fg = lab != 0
    r = width_px / 2.0
    dil = ndimage.distance_transform_edt(~fg) <= r
    closed = (ndimage.distance_transform_edt(dil) >= r - 0.5) | fg
    return reassign(lab, closed & ~fg)


def smooth_labels(lab, sigma):
    """Light per-label blur and re-pick, to round off ragged steps left by the fixes."""
    if sigma < 0.5:
        return lab
    best = None
    out = lab.copy()
    for v in np.unique(lab):
        w = ndimage.gaussian_filter((lab == v).astype(np.float32), sigma)
        if best is None:
            best = w
            out[:] = v
        else:
            m = w > best
            best[m] = w[m]
            out[m] = v
    return out


def _settle(out, labels, wf, wg, thin_features, tries=4):
    for _ in range(tries):
        out, changed = fix_features(out, labels, wf, thin_features)
        if thin_spots(out == 0, wg).any():
            changed = True
            out = close_gaps(out, wg)                      # never makes a feature thinner
        if not changed:
            break
    return out


def fit_to_nozzle(lab, g, nozzle_mm, feature_factor=1.05, gap_factor=1.0, gaps="fill",
                  thin_features="widen", rounds=2):
    """Return (fitted label map, report). g = inches per grid cell.

    1. open mode only: widen thin features, then widen narrow gaps by pushing features back (rounds)
    2. settle: widen thin features; close remaining narrow gaps (the slicer would merge them anyway)
    3. smooth lightly, then settle again, so the result is both clean and within the minimums"""
    px_per_mm = 1.0 / (g * 25.4)
    wf = feature_factor * nozzle_mm * px_per_mm
    wg = gap_factor * nozzle_mm * px_per_mm
    labels = [v for v in np.unique(lab) if v != 0]
    pad = int(np.ceil(max(wf, wg))) + 4                    # room outside the art, so the map edge is not a "gap"
    out = np.pad(lab, pad)
    if gaps == "open":
        for _ in range(rounds):
            out, _ = fix_features(out, labels, wf, thin_features)
            t = thin_spots(out == 0, wg)
            if t.any():
                out = widen(out, 0, t, wg)
    out = _settle(out, labels, wf, wg, thin_features)
    out = smooth_labels(out, 0.12 * min(wf, wg))
    out = _settle(out, labels, wf, wg, thin_features)
    base = np.pad(lab, pad)
    art = max(int((base != 0).sum()), 1)
    changed_pct = 100.0 * int((out != base).sum()) / art   # how much of the artwork the fit had to move
    gap_rep = spot_report(thin_spots(out == 0, wg), g)    # on the padded map: the map edge is not a gap
    feat_rep = {int(v): spot_report(thin_spots(out == v, wf), g) for v in labels}
    ys, xs = np.nonzero(out)                               # crop back to the art (it may have grown slightly)
    m = 2
    out = out[max(ys.min() - m, 0):ys.max() + m + 1, max(xs.min() - m, 0):xs.max() + m + 1]
    report = {"nozzle_mm": nozzle_mm, "min_feature_mm": feature_factor * nozzle_mm,
              "min_gap_mm": gap_factor * nozzle_mm, "gaps": gaps, "thin_features": thin_features,
              "features": feat_rep, "gap": gap_rep, "changed_pct": round(changed_pct, 1)}
    report["size_in"] = (round(out.shape[1] * g, 3), round(out.shape[0] * g, 3))
    return out, report


def check(lab, g, nozzle_mm, feature_factor=1.05, gap_factor=1.0):
    """Thin-spot report for an existing label map, without changing it."""
    px_per_mm = 1.0 / (g * 25.4)
    lab = np.pad(lab, int(np.ceil(max(feature_factor, gap_factor) * nozzle_mm * px_per_mm)) + 4)
    rep = {"gap": spot_report(thin_spots(lab == 0, gap_factor * nozzle_mm * px_per_mm), g), "features": {}}
    for v in np.unique(lab):
        if v != 0:
            rep["features"][int(v)] = spot_report(thin_spots(lab == v, feature_factor * nozzle_mm * px_per_mm), g)
    return rep
```

### `scripts/pipeline.py`

```python
"""Fit a label map to one or more nozzle sizes, export DXFs, verify each, and summarize.

For each nozzle N in --nozzle-mm:
  PREFIX_nN.npz        label map fitted to N (features >= feature_factor x N, gaps >= gap_factor x N)
  PREFIX_nN.dxf        single DXF, every boundary once     (+ PREFIX_nN_<color>.dxf with --per-label)
  PREFIX_nN.png        preview drawn from the DXF
  PREFIX_nN.3mf        with --3mf: ready-to-slice test plate (Bambu Studio, Orca and forks), one part
                       per material with filaments assigned 1..N, checked watertight;
                       PREFIX_nN_3mf.png is its top-down preview
  PREFIX_summary.md    one row per nozzle: size, faces, CAD checks, remaining thin spots

With --svg, also PREFIX.svg: filled, scalable artwork for Affinity, Illustrator and the like, one
group per color, made from the unfitted label map so 3D-print line widening stays out of it, and
PREFIX_svg.png, its preview. --svg nozzle or --svg both add PREFIX_nN.svg from each fitted map.

Sizes: --width/--height take a unit (5in, 127mm, 12.7cm). The label map is rescaled up or down to
fit that box without distortion. --fit art (default) sizes the artwork; --fit plate sizes the whole
3MF plate, border included. Without a size, the label map's own size is kept.

3MF plates (--3mf): default style inset, the design inlaid flush to a depth of 10 layers of
nozzle/2 (0.4 mm nozzle: 2 mm). One-color art gets a separate plate (2 materials); multi-color art
uses one of its colors as the plate (the shield: 3 materials).

Example:
  python pipeline.py labels.npz out/truck --nozzle-mm 0.2,0.4,0.6,0.8 --width 5in --3mf
"""
import argparse
import json
import os
import subprocess
import sys

from scipy import ndimage

from dxf_io import load_labels, save_labels, parse_length
from nozzle import fit_to_nozzle
from labels_to_3mf import layer_heights

HERE = os.path.dirname(os.path.abspath(__file__))


def run(args):
    r = subprocess.run([sys.executable, os.path.join(HERE, args[0])] + args[1:], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("labels", help="raw label map from make_labels.py or a rebuild script")
    ap.add_argument("prefix", help="output path prefix, e.g. out/truck")
    ap.add_argument("--nozzle-mm", default="0.4", help="one or more nozzle diameters, comma-separated")
    ap.add_argument("--feature-factor", type=float, default=1.05,
                    help="minimum feature = factor x nozzle (1.05: 5%% over the nozzle, so slicers do not drop lines)")
    ap.add_argument("--gap-factor", type=float, default=1.0, help="minimum gap = factor x nozzle")
    ap.add_argument("--gaps", choices=["open", "fill"], default="fill",
                    help="fill (default): close narrow gaps smoothly; open: first push features back to keep gaps")
    ap.add_argument("--thin-features", choices=["widen", "remove"], default="widen")
    ap.add_argument("--per-label", action="store_true", help="also write one DXF per color")
    ap.add_argument("--width", help="target width with unit: 5in, 127mm, 12.7cm")
    ap.add_argument("--height", help="target height with unit")
    ap.add_argument("--fit", choices=["art", "plate"], default="art",
                    help="whether --width/--height size the artwork or the whole 3MF plate")
    ap.add_argument("--width-in", type=float, help=argparse.SUPPRESS)
    ap.add_argument("--height-in", type=float, help=argparse.SUPPRESS)
    ap.add_argument("--tol-in", type=float, default=0.0005)
    ap.add_argument("--3mf", dest="three_mf", action="store_true", help="also write a 3MF test plate per nozzle")
    ap.add_argument("--style", choices=["inset", "relief", "flat"], default="inset",
                    help="3MF: design inlaid flush (default), raised on a base, or a flat tile")
    ap.add_argument("--inset-layers", type=int, default=10, help="3MF inset depth in layers (default 10)")
    ap.add_argument("--inset-mm", type=float, help="3MF inset depth in mm (overrides --inset-layers)")
    ap.add_argument("--layer-mm", type=float, help="layer height (default: nozzle / 2)")
    ap.add_argument("--base-mm", type=float, default=1.2, help="3MF: solid plate under the inset or relief")
    ap.add_argument("--relief-mm", type=float, default=0.6, help="3MF relief style: art height above the base")
    ap.add_argument("--body", default="auto", help="3MF inset, multi-color: which color forms the plate")
    ap.add_argument("--materials", type=int, help="3MF: fail unless the plate uses exactly this many materials")
    ap.add_argument("--base-color", default="#a0a0a0", help="3MF: color of a separate plate part")
    ap.add_argument("--base-shape", choices=["auto", "rect", "footprint"], default="auto")
    ap.add_argument("--margin-mm", type=float, default=2.0, help="3MF rect base: border around the art")
    ap.add_argument("--bambu", choices=["auto", "on", "off"], default="auto",
                    help="3MF: include a Bambu Studio project configuration (auto: when Bambu presets are found)")
    ap.add_argument("--printer", default="Bambu Lab X1 Carbon", help="3MF: Bambu printer model for the project")
    ap.add_argument("--bambu-profiles", help="3MF: Bambu profile folder (resources/profiles/BBL or system/BBL)")
    ap.add_argument("--bambu-version", default="02.08.00.00",
                    help="3MF: version in the BambuStudio Application tag; keep it at or below the installed one")
    ap.add_argument("--svg", nargs="?", const="art", choices=["art", "nozzle", "both"],
                    help="also write an SVG: art (default) is one file from the unfitted artwork, for design "
                         "programs; nozzle is one per nozzle, with the fitted line widths; both writes each")
    a = ap.parse_args()

    lab, g, names, colors = load_labels(a.labels)
    a.width_in = parse_length(a.width) or a.width_in
    a.height_in = parse_length(a.height) or a.height_in
    feats = [v for v in range(1, len(names)) if (lab == v).any()]
    rect = a.base_shape == "rect" or (a.base_shape == "auto" and len(feats) == 1)
    border = 2 * a.margin_mm / 25.4 if (a.fit == "plate" and a.three_mf and a.style != "flat" and rect) else 0.0
    box_w = a.width_in - border if a.width_in else None     # the artwork's box
    box_h = a.height_in - border if a.height_in else None
    os.makedirs(os.path.dirname(os.path.abspath(a.prefix)), exist_ok=True)

    def make_svg(labels, out):
        """Write and check one SVG sized to the artwork's box. Returns (result, verifier output)."""
        size = [x for flag, v in (("--width", box_w), ("--height", box_h)) if v for x in (flag, f"{v}in")]
        code, text = run(["labels_to_svg.py", labels, out] + size)
        if code == 0:
            code, text = run(["verify_svg.py", out, "--labels", labels, "--preview", out[:-4] + "_svg.png"] + size)
        return ("PASS" if code == 0 else "FAIL"), text

    svg_results = []
    if a.svg in ("art", "both"):
        svg_results.append((a.prefix + ".svg",) + make_svg(a.labels, a.prefix + ".svg"))
    rows = []
    for n in [float(x) for x in a.nozzle_mm.split(",")]:
        tag = f"{a.prefix}_n{n:g}"
        # fit on a grid where the nozzle spans ~16 cells: 1/16-nozzle precision, far fewer cells (speed)
        step = 2 if n / 25.4 / (2 * g) >= 12 else 1   # nozzle >= 12 cells at stride 2; above 2 breaks thin lines
        src, gs = lab[::step, ::step], g * step
        # scale the art to the requested box (up or down); then, if widened tips at the edges push it
        # past the box, shrink slightly and refit
        cur_w, cur_h = src.shape[1] * gs, src.shape[0] * gs
        fits = [x for x in (box_w and box_w / cur_w, box_h and box_h / cur_h) if x]
        scale = min(fits) if fits else 1.0
        for _ in range(5):
            work = src if abs(scale - 1.0) < 1e-6 else ndimage.zoom(src, scale, order=0)
            fitted, rep = fit_to_nozzle(work, gs, n, a.feature_factor, a.gap_factor, a.gaps, a.thin_features)
            w, h = rep["size_in"]
            over = max(w / box_w if box_w else 0, h / box_h if box_h else 0)
            if over <= 1.0005:
                break
            scale /= over * 1.001
        rep["source_scale"] = round(scale, 4)
        save_labels(tag + ".npz", fitted, gs, names, colors)
        cmd = ["labels_to_dxf.py", tag + ".npz", tag + ".dxf", "--tol-in", str(a.tol_in)]
        if a.per_label:
            cmd += ["--per-label", tag]
        code, out = run(cmd)
        if code:
            print(out)
            sys.exit(code)
        vcmd = ["verify_dxf.py", tag + ".dxf", "--labels", tag + ".npz", "--preview", tag + ".png",
                "--nozzle-mm", str(n), "--feature-factor", str(a.feature_factor), "--gap-factor", str(a.gap_factor)]
        if box_w:
            vcmd += ["--width-in", str(box_w)]
        if box_h:
            vcmd += ["--height-in", str(box_h)]
        vcode, vout = run(vcmd)
        if a.per_label:
            for v in range(1, len(names)):
                path = f"{tag}_{names[v]}.dxf"
                if os.path.exists(path):
                    pc, po = run(["verify_dxf.py", path])
                    vcode |= pc
                    if pc:
                        vout += f"\n{path}:\n{po}"
        mf, mats, plate, inset = "-", "-", "-", "-"
        if a.three_mf:
            m_cmd = ["labels_to_3mf.py", tag + ".npz", tag + ".3mf", "--style", a.style, "--nozzle-mm", str(n),
                     "--inset-layers", str(a.inset_layers), "--base-mm", str(a.base_mm),
                     "--relief-mm", str(a.relief_mm), "--base-shape", a.base_shape, "--margin-mm", str(a.margin_mm),
                     "--body", a.body, "--base-color", a.base_color, "--tol-in", str(a.tol_in),
                     "--bambu", a.bambu, "--printer", a.printer, "--bambu-version", a.bambu_version]
            if a.bambu_profiles:
                m_cmd += ["--bambu-profiles", a.bambu_profiles]
            for flag, val in (("--inset-mm", a.inset_mm), ("--layer-mm", a.layer_mm), ("--materials", a.materials)):
                if val:
                    m_cmd += [flag, str(val)]
            mcode, mout = run(m_cmd)
            m3 = ["verify_3mf.py", tag + ".3mf", "--labels", tag + ".npz", "--preview", tag + "_3mf.png"]
            if box_w:
                m3 += ["--width-in", str(box_w)]
            if box_h:
                m3 += ["--height-in", str(box_h)]
            if a.materials:
                m3 += ["--materials", str(a.materials)]
            if a.fit == "plate":
                if a.width_in:
                    m3 += ["--plate-width-in", str(a.width_in)]
                if a.height_in:
                    m3 += ["--plate-height-in", str(a.height_in)]
            vc3, vo3 = run(m3) if mcode == 0 else (mcode, mout)
            for line in vo3.splitlines():
                if line.startswith("materials:"):
                    mats = line.split(":")[1].strip()
                if line.startswith("object "):
                    plate = line.split("triangles, ")[1].split(" mm")[0] + " mm"
            if a.style == "inset":
                layer, depth = layer_heights(n, a.layer_mm, a.inset_layers, a.inset_mm)
                inset = f"{depth:g} mm ({depth / layer:g} x {layer:g})"
            mf = "PASS" if vc3 == 0 else "FAIL"
            vcode |= vc3
            if vc3:
                vout += f"\n{tag}.3mf:\n{vo3}"
        if a.svg in ("nozzle", "both"):
            svg_results.append((tag + ".svg",) + make_svg(tag + ".npz", tag + ".svg"))
        faces = next((l.split(":")[1].strip() for l in vout.splitlines() if l.startswith("closed faces drawn")), "?")
        thin_f = sum(r["count"] for r in rep["features"].values())
        thin_g = rep["gap"]["count"]
        where = [w for r in rep["features"].values() for w in r["where_in"]] + rep["gap"]["where_in"]
        rows.append((n, rep["size_in"], faces, "PASS" if vcode == 0 else "FAIL", thin_f, thin_g, where[:3],
                     rep["changed_pct"], mf, mats, plate, inset))
        print(f"nozzle {n:g} mm: size {rep['size_in'][0]} x {rep['size_in'][1]} in (source x{scale:.4f}), faces {faces}, "
              f"CAD checks {'PASS' if vcode == 0 else 'FAIL'}, thin features left {thin_f}, narrow gaps left {thin_g}")
        if vcode:
            print(vout)
        with open(tag + "_fit.json", "w") as f:
            json.dump(rep, f, indent=1)

    md = ["| Nozzle | Min feature / gap | Art (in) | Art (mm) | Faces | Art changed | Checks | 3MF | Materials | Plate | Inset | Thin features left | Narrow gaps left | First spots (in) |",
          "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for n, size, faces, ok, tf, tg, where, ch, mf, mats, plate, inset in rows:
        md.append(f"| {n:g} mm | {a.feature_factor * n:g} / {a.gap_factor * n:g} mm | {size[0]} x {size[1]} | "
                  f"{size[0] * 25.4:.1f} x {size[1] * 25.4:.1f} | {faces} | {ch}% | {ok} | {mf} | {mats} | {plate} | {inset} | "
                  f"{tf} | {tg} | {', '.join(f'({x}, {y})' for x, y in where) or '-'} |")
    md.append("")
    md.append("Art changed: share of the artwork's area the fit had to move. Above roughly 25%, the detail is finer "
              "than the nozzle at this size; print larger or use a smaller nozzle for a faithful result.")
    if svg_results:
        md += ["", "| SVG | Checks | Size | Paths | Nodes | Largest drift from the label map |", "|---|---|---|---|---|---|"]
        for path, ok, text in svg_results:
            found = dict(l.split(": ", 1) for l in text.splitlines() if ": " in l)
            md.append(f"| {os.path.basename(path)} | {ok} | {found.get('size', '?')} | {found.get('paths', '?')} | "
                      f"{found.get('nodes', '?')} | {found.get('largest drift', '?')} |")
            if ok != "PASS":
                print(f"{path}:\n{text}")
    open(a.prefix + "_summary.md", "w").write("\n".join(md) + "\n")
    print("\n".join(md))
    sys.exit(0 if all(r[3] == "PASS" for r in rows) and all(s[1] == "PASS" for s in svg_results) else 1)


if __name__ == "__main__":
    main()
```

### `scripts/labels_to_dxf.py`

```python
"""Convert a label map into DXF curves that Onshape can extrude.

Single file (default): every boundary between two different labels appears exactly once. Curves
run between junctions (points where three or more labels meet) and share exact endpoints, so one
sketch gets one clickable region per color area, with no doubled or near-duplicate edges.

--per-label PREFIX also writes PREFIX_<name>.dxf with just that label's outline loops, for
putting each color in its own sketch.

How: label boundaries are taken as pixel-cell edges, chained between junctions, smoothed with the
junction endpoints held fixed, simplified to --tol-in, then checked for crossings. Chains involved
in a crossing are re-simplified with a smaller tolerance until none remain.

Example:
  python labels_to_dxf.py labels.npz part.dxf --per-label part
"""
import argparse
from collections import defaultdict
import numpy as np
from scipy.ndimage import uniform_filter1d
from skimage.measure import approximate_polygon

from dxf_io import load_labels, write_dxf, find_crossings


def boundary_chains(lab):
    """Chains of cell-corner vertices along label boundaries. Returns (list of (verts, closed), Wv)."""
    lab = np.pad(lab, 1)                              # pad with background so outer edges close
    H, W = lab.shape
    Wv = W + 1
    hr, hc = np.nonzero(lab[:-1, :] != lab[1:, :])    # horizontal cell edges
    vr, vc = np.nonzero(lab[:, :-1] != lab[:, 1:])    # vertical cell edges
    ea = np.concatenate([(hr + 1) * Wv + hc, vr * Wv + vc + 1])
    eb = np.concatenate([(hr + 1) * Wv + hc + 1, (vr + 1) * Wv + vc + 1])
    adj = defaultdict(list)
    for i, (a, b) in enumerate(zip(ea.tolist(), eb.tolist())):
        adj[a].append(i)
        adj[b].append(i)
    junction = {v for v, e in adj.items() if len(e) != 2}
    used = np.zeros(len(ea), bool)

    def walk(start, e):
        verts, v = [start], start
        while True:
            used[e] = True
            v = int(eb[e] if ea[e] == v else ea[e])
            verts.append(v)
            if v in junction or v == start:
                return verts
            nxt = [x for x in adj[v] if not used[x]]
            if not nxt:
                return verts
            e = nxt[0]

    chains = []
    for j in junction:
        for e in adj[j]:
            if not used[e]:
                chains.append((walk(j, e), False))
    for e in range(len(ea)):
        if not used[e]:
            verts = walk(int(ea[e]), e)
            chains.append((verts[:-1], True))
    return chains, Wv, H


def chain_points(verts, closed, Wv, H, g, smooth=5):
    """One vertex-id chain -> dense smoothed points in inches, Y up. Junction ends stay exact."""
    v = np.array(verts)
    r, c = v // Wv - 1, v % Wv - 1                   # undo the pad
    p = np.stack([c * g, (H - 2 - r) * g], 1).astype(float)
    if len(p) > smooth + 1:
        if closed:
            p = uniform_filter1d(p, size=smooth, axis=0, mode="wrap")
        else:
            q = uniform_filter1d(p, size=smooth, axis=0, mode="nearest")
            q[0], q[-1] = p[0], p[-1]                # junction endpoints stay exact
            p = q
    return p


def chains_to_curves(chains, Wv, H, g, tol_in, smooth=5):
    """Vertex-id chains -> smoothed, simplified (points in inches, closed) curves."""
    raw = [(chain_points(verts, closed, Wv, H, g, smooth), closed) for verts, closed in chains]

    def simplify(p, closed, tol):
        if closed:
            s = approximate_polygon(np.vstack([p, p[:1]]), tolerance=tol)[:-1]
            return s if len(s) >= 3 else p
        return approximate_polygon(p, tolerance=tol)

    tols = [tol_in] * len(raw)
    curves = [(simplify(p, c, t), c) for (p, c), t in zip(raw, tols)]
    for _ in range(8):
        hits = find_crossings(curves)
        if not hits:
            break
        for ci in {h[0] for h in hits} | {h[1] for h in hits}:
            tols[ci] /= 2
            p, c = raw[ci]
            curves[ci] = (simplify(p, c, tols[ci]) if tols[ci] > g / 8 else p, c)
    return curves


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("labels")
    ap.add_argument("out", help="single DXF with every boundary once")
    ap.add_argument("--per-label", metavar="PREFIX", help="also write PREFIX_<label>.dxf per non-background label")
    ap.add_argument("--tol-in", type=float, default=0.0005, help="max deviation from the traced edge, inches")
    a = ap.parse_args()
    lab, g, names, _ = load_labels(a.labels)

    chains, Wv, H = boundary_chains(lab)
    curves = chains_to_curves(chains, Wv, H, g, a.tol_in)
    origin = np.vstack([p for p, _ in curves]).min(0)       # bottom-left of the artwork goes to 0,0
    curves = [(p - origin, c) for p, c in curves]
    write_dxf(a.out, curves)
    hits = find_crossings(curves)
    print(f"{a.out}: {len(curves)} curves, {sum(len(p) for p, _ in curves)} vertices, crossings {len(hits)}, "
          f"size {np.ptp(np.vstack([p for p, _ in curves]), 0)[0]:.3f} x {np.ptp(np.vstack([p for p, _ in curves]), 0)[1]:.3f} in")

    if a.per_label:
        for v in range(1, len(names)):
            m = (lab == v).astype(np.uint8)
            if not m.any():
                continue
            ch, Wv2, H2 = boundary_chains(m)
            cv = [(p - origin, c) for p, c in chains_to_curves(ch, Wv2, H2, g, a.tol_in)]   # same offset: files line up
            path = f"{a.per_label}_{names[v]}.dxf"
            write_dxf(path, cv, layer=names[v].upper())
            print(f"{path}: {len(cv)} loops, crossings {len(find_crossings(cv))}")


if __name__ == "__main__":
    main()
```

### `scripts/verify_dxf.py`

```python
"""Check a DXF before handing it over, and render a preview from the DXF itself.

Checks:
  - crossings: segments that touch or cross (Onshape cannot build regions there)
  - dangling ends: open curve ends that do not meet another curve end exactly
  - extents against --width-in / --height-in
  - shortest segment
  - with --labels: closed faces drawn by the DXF vs color regions in the label map (must match),
    and printability for --nozzle-mm: features thinner than feature_factor x nozzle and gaps
    narrower than gap_factor x nozzle (warnings, with locations in inches)

Exit code 1 if any hard check fails.

Example:
  python verify_dxf.py part.dxf --labels labels.npz --width-in 3 --height-in 3 --preview preview.png
"""
import argparse
from collections import Counter
import sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from dxf_io import read_dxf, find_crossings, load_labels
from nozzle import check as nozzle_check


def faces_from_curves(curves, lo, hi, dpi):
    W = int((hi[0] - lo[0]) * dpi) + 20
    H = int((hi[1] - lo[1]) * dpi) + 20
    im = Image.new("1", (W, H), 0)
    d = ImageDraw.Draw(im)
    tf = lambda p: [(float((x - lo[0]) * dpi + 10), float(H - 10 - (y - lo[1]) * dpi)) for x, y in p]
    for p, closed in curves:
        q = np.vstack([p, p[:1]]) if closed else p
        d.line(tf(q), fill=1, width=1)
    lines = np.array(im)
    comp, n = ndimage.label(~lines)
    edge = set(np.unique(np.r_[comp[0], comp[-1], comp[:, 0], comp[:, -1]]))
    sizes = ndimage.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
    # faces under 3x3 raster px are pixels trapped where drawn lines pinch at sharp vertices
    return comp, [i for i in range(1, n + 1) if i not in edge and sizes[i - 1] >= 9], lines, tf


def label_regions(lab, min_cells=0):
    """Connected areas of each label that become faces. Background areas touching the map border are
    outside the part; every other area (colored ones touching the border included, since the
    exporter closes them along the border) is a face."""
    total = tiny = 0
    for v in np.unique(lab):
        comp, n = ndimage.label(lab == v)
        if n == 0:
            continue
        sizes = ndimage.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
        edge = set(np.unique(np.r_[comp[0], comp[-1], comp[:, 0], comp[:, -1]])) if v == 0 else set()
        for i in range(1, n + 1):
            if i in edge:
                continue
            if sizes[i - 1] < min_cells:
                tiny += 1
            else:
                total += 1
    return total, tiny


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dxf")
    ap.add_argument("--labels", help="labels .npz the DXF was made from")
    ap.add_argument("--width-in", type=float)
    ap.add_argument("--height-in", type=float)
    ap.add_argument("--dpi", type=int, default=1000, help="raster resolution for the face check")
    ap.add_argument("--preview", help="write a PNG preview rendered from the DXF")
    ap.add_argument("--nozzle-mm", type=float, default=0.4, help="nozzle for the printability check")
    ap.add_argument("--feature-factor", type=float, default=1.05, help="minimum feature = factor x nozzle")
    ap.add_argument("--gap-factor", type=float, default=1.0, help="minimum gap = factor x nozzle")
    a = ap.parse_args()

    curves = read_dxf(a.dxf)
    ok = True
    pts = np.vstack([p for p, _ in curves])
    lo, hi = pts.min(0), pts.max(0)
    size = hi - lo
    print(f"curves: {len(curves)} ({sum(c for _, c in curves)} closed, {sum(not c for _, c in curves)} open), "
          f"vertices: {len(pts)}")
    print(f"extents: {size[0]:.3f} x {size[1]:.3f} in, origin ({lo[0]:.3f}, {lo[1]:.3f})")
    for name, want, got in (("width", a.width_in, size[0]), ("height", a.height_in, size[1])):
        if want and got > want + 0.005:
            print(f"FAIL {name} {got:.3f} in exceeds {want} in")
            ok = False

    hits = find_crossings(curves)
    print(f"crossings: {len(hits)}" + (f"  first at ({hits[0][2]:.3f}, {hits[0][3]:.3f}) in" if hits else ""))
    ok &= not hits

    ends = Counter(tuple(np.round(p[i], 5)) for p, c in curves if not c for i in (0, -1))
    dangling = sum(1 for n in ends.values() if n < 2)
    print(f"dangling ends: {dangling}")
    ok &= dangling == 0

    seg = np.concatenate([np.linalg.norm(np.diff(np.vstack([p, p[:1]]) if c else p, axis=0), axis=1)
                          for p, c in curves])
    print(f"shortest segment: {seg.min():.5f} in")

    comp, faces, lines, tf = faces_from_curves(curves, lo, hi, a.dpi)
    print(f"closed faces drawn: {len(faces)}")
    lab = None
    if a.labels:
        lab, g, names, colors = load_labels(a.labels)
        min_cells = (4.0 / a.dpi / g) ** 2              # areas below ~4x4 raster px cannot be checked
        regions, tiny = label_regions(lab, min_cells)
        print(f"color regions in label map: {regions}")
        if tiny:
            print(f"WARN {tiny} region(s) smaller than {4 / a.dpi * 25.4:.2f} mm across: specks the face check "
                  f"cannot see at --dpi {a.dpi}; clean them up or ignore if harmless")
        if regions != len(faces):
            # a sliver narrower than ~2 raster px can be split or swallowed by the drawn lines; look closer once
            hi_dpi = a.dpi * 3
            _, faces3, _, _ = faces_from_curves(curves, lo, hi, hi_dpi)
            regions3, _ = label_regions(lab, (4.0 / hi_dpi / g) ** 2)
            print(f"recheck at {hi_dpi} dpi: faces {len(faces3)}, regions {regions3}")
            if regions3 != len(faces3):
                print("FAIL face count does not match the label map: some region is not closed by the curves")
                ok = False
        rep = nozzle_check(lab, g, a.nozzle_mm, a.feature_factor, a.gap_factor)
        mf, mg = a.feature_factor * a.nozzle_mm, a.gap_factor * a.nozzle_mm
        for v, r in rep["features"].items():
            print(f"{names[v]}: {r['count']} spot(s) thinner than {mf:g} mm" +
                  (f"  WARN {r['area_mm2']:.3f} mm2, largest at {r['where_in']}" if r["count"] else ""))
        r = rep["gap"]
        print(f"gaps: {r['count']} spot(s) narrower than {mg:g} mm" +
              (f"  WARN {r['area_mm2']:.3f} mm2, largest at {r['where_in']}" if r["count"] else ""))

    if a.preview:
        H, W = lines.shape
        img = np.zeros((H, W, 3), np.uint8)
        img[:] = (255, 255, 255)
        if lab is not None:
            # colour each DXF face by the majority label underneath it (label grid: x = c*g, y = (rows - r)*g)
            yy, xx = np.mgrid[0:H, 0:W]
            x_in = (xx - 10) / a.dpi + lo[0]
            y_in = (H - 10 - yy) / a.dpi + lo[1]
            r = np.clip((lab.shape[0] - y_in / g).astype(int), 0, lab.shape[0] - 1)
            c = np.clip((x_in / g).astype(int), 0, lab.shape[1] - 1)
            under = lab[r, c].astype(np.int64)
            nl = len(colors)
            votes = np.bincount((comp * nl + under).ravel(), minlength=(comp.max() + 1) * nl).reshape(-1, nl)
            outside = (45, 45, 45)                     # dark, so white parts show; also used for enclosed holes
            lut = np.full((comp.max() + 1, 3), outside, np.uint8)
            for f in faces:
                v = int(votes[f].argmax())
                lut[f] = colors[v] if v != 0 else outside
            img = lut[comp]
            img[lines] = (150, 150, 150)
        else:
            img[:] = (0, 0, 0)
            img[lines] = (255, 255, 255)
        Image.fromarray(img).save(a.preview)
        print(f"preview: {a.preview}")

    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
```

### `scripts/labels_to_svg.py`

```python
"""Convert a label map into a scalable SVG for vector design programs (Affinity, Illustrator).

The SVG holds filled shapes, not outlines: one group per color, one path per connected area with
its holes cut out. Curves are cubic Beziers fitted to the same boundary chains the DXF uses, and
each chain is fitted once, then shared by the colors on its two sides. Neighboring colors therefore
meet on identical edges, with no gaps or overlaps, at any scale. Sharp corners stay corner nodes,
straight runs stay straight lines. The background label is left out (transparent).

Sizes are real: width and height in mm, with a viewBox in mm, so the art opens at its size.

Use the raw label map for artwork. A nozzle-fitted map (PREFIX_nN.npz) gives a file with the 3D-print
line widths built in, which is only wanted when the SVG will go to a slicer.

Example:
  python labels_to_svg.py labels.npz logo.svg --width 76mm
"""
import argparse
import os
from xml.sax.saxutils import escape, quoteattr
import numpy as np
from skimage.measure import approximate_polygon

from dxf_io import find_crossings, load_labels, parse_length, fmt_size
from labels_to_dxf import boundary_chains, chain_points

MM = 25.4
FLAT = np.linspace(0, 1, 12, endpoint=False)               # points per cubic for crossing checks, as in verify_svg.py


# Curve fitting (Schneider's method, from Graphics Gems)

def bezier_at(b, u):
    u = np.asarray(u)[:, None]
    return ((1 - u) ** 3 * b[0] + 3 * u * (1 - u) ** 2 * b[1] + 3 * u ** 2 * (1 - u) * b[2] + u ** 3 * b[3])


def unit(v):
    n = np.hypot(*v)
    return v / n if n > 0 else v


def chord_params(p):
    d = np.r_[0.0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
    return d / d[-1] if d[-1] > 0 else np.linspace(0, 1, len(p))


def solve_handles(p, u, t0, t1):
    """Least-squares handle lengths for a cubic from p[0] to p[-1] leaving along t0, arriving along t1."""
    b0, b1, b2, b3 = (1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u ** 2 * (1 - u), u ** 3
    a0, a1 = b1[:, None] * t0, b2[:, None] * t1
    rest = p - ((b0 + b1)[:, None] * p[0] + (b2 + b3)[:, None] * p[-1])
    c00, c01, c11 = (a0 * a0).sum(), (a0 * a1).sum(), (a1 * a1).sum()
    x0, x1 = (a0 * rest).sum(), (a1 * rest).sum()
    det = c00 * c11 - c01 ** 2
    chord = np.hypot(*(p[-1] - p[0]))
    l0, l1 = ((x0 * c11 - x1 * c01) / det, (c00 * x1 - c01 * x0) / det) if abs(det) > 1e-18 else (0.0, 0.0)
    if l0 < 1e-6 * chord or l1 < 1e-6 * chord or l0 > 3 * chord or l1 > 3 * chord:
        l0 = l1 = chord / 3
    return np.array([p[0], p[0] + l0 * t0, p[-1] + l1 * t1, p[-1]])


def reparameterize(b, p, u):
    """One Newton step toward the parameter of the closest curve point for each p."""
    d1 = 3 * (b[1:] - b[:-1])
    d2 = 2 * (d1[1:] - d1[:-1])
    w = u[:, None]
    q = bezier_at(b, u)
    q1 = (1 - w) ** 2 * d1[0] + 2 * w * (1 - w) * d1[1] + w ** 2 * d1[2]
    q2 = (1 - w) * d2[0] + w * d2[1]
    num = ((q - p) * q1).sum(1)
    den = (q1 * q1).sum(1) + ((q - p) * q2).sum(1)
    step = np.divide(num, den, out=np.zeros_like(num), where=np.abs(den) > 1e-18)
    return np.clip(u - step, 0, 1)


def fit_span(p, t0, t1, tol, reach, out):
    """Append cubics to out that stay within tol of the points p, ends tangent to t0 and t1."""
    if len(p) < 3:
        d = np.hypot(*(p[-1] - p[0])) / 3
        out.append(np.array([p[0], p[0] + d * t0, p[-1] + d * t1, p[-1]]))
        return
    u = chord_params(p)
    worst = 0
    for _ in range(4):
        b = solve_handles(p, u, t0, t1)
        err = np.hypot(*(bezier_at(b, u) - p).T)
        worst = int(err.argmax())
        if err[worst] <= tol:
            out.append(b)
            return
        if err[worst] > 8 * tol:
            break
        u = reparameterize(b, p, u)
    split = min(max(worst, 1), len(p) - 2)
    mid = unit(p[max(split - reach, 0)] - p[min(split + reach, len(p) - 1)])
    fit_span(p[:split + 1], t0, mid, tol, reach, out)
    fit_span(p[split:], -mid, t1, tol, reach, out)


def find_corners(p, closed, k, angle_deg):
    """Indices where the path turns sharply, compared over k points each way."""
    n = len(p)
    if n < 2 * k + 1:
        return []
    i = np.arange(n) if closed else np.arange(k, n - k)
    a, b = p[i] - p[(i - k) % n], p[(i + k) % n] - p[i]
    cos = (a * b).sum(1) / np.maximum(np.hypot(*a.T) * np.hypot(*b.T), 1e-12)
    turn = np.degrees(np.arccos(np.clip(cos, -1, 1)))
    corners = []
    for j in np.argsort(-turn):
        if turn[j] < angle_deg:
            break
        ci = int(i[j])
        if all(min(abs(ci - c), n - abs(ci - c) if closed else n) > k for c in corners):
            corners.append(ci)
    return sorted(corners)


def end_tangent(q, skip, cell):
    """Direction leaving q[0], read from the longest straight run past the skipped points. Smoothing
    rounds the last few points into a corner, and a tangent taken from those makes straight edges bow."""
    best = None
    for m in (8, 16, 32, 64):
        if skip + m >= len(q):
            break
        d = unit(q[skip + m] - q[skip])
        if np.abs((q[skip:skip + m + 1] - q[skip]) @ np.array([-d[1], d[0]])).max() > 0.75 * cell:
            break
        best = d
    return best if best is not None else unit(q[min(skip + 4, len(q) - 1)] - q[min(skip, len(q) - 2)])


def meet(a, da, b, db):
    """Where the line through a along da crosses the line through b along db, or None if parallel."""
    det = da[0] * db[1] - da[1] * db[0]
    if abs(det) < 1e-6:
        return None
    return a + ((b[0] - a[0]) * db[1] - (b[1] - a[1]) * db[0]) / det * da


def fit_chain(p, closed, tol, k, angle_deg, cell, trim=3):
    """Dense points of one boundary chain -> list of (4, 2) cubics, in order. Corners inside the chain
    are rebuilt where their two sides meet, which undoes the rounding from smoothing the trace."""
    reach = 2 * k                                          # wide, so the pixel staircase cannot tilt a split
    keep = np.r_[True, np.hypot(*np.diff(p, axis=0).T) > 0]
    p = p[keep]
    corners = find_corners(p, closed, k, angle_deg)
    one_loop = closed and not corners                      # no corner to start from: a smooth seam
    if closed:
        first = corners[0] if corners else 0
        wrapped = np.vstack([np.roll(p, -first, axis=0), p[first:first + 1]])
        stops = [c - first for c in corners] + [len(p)] if corners else [0, len(p)]
        p = wrapped
    else:
        stops = [0] + corners + [len(p) - 1]
    spans = [p[a:b + 1] for a, b in zip(stops[:-1], stops[1:])]
    skip = [trim if len(q) > 2 * trim + 2 else 0 for q in spans]
    leave = [end_tangent(q, s, cell) for q, s in zip(spans, skip)]
    arrive = [end_tangent(q[::-1], s, cell) for q, s in zip(spans, skip)]
    heads, tails = [q[0] for q in spans], [q[-1] for q in spans]
    cut_head, cut_tail = [1] * len(spans), [1] * len(spans)
    joints = [(i, i + 1) for i in range(len(spans) - 1)]
    if closed and corners:
        joints.append((len(spans) - 1, 0))
    for i, j in joints:
        if skip[i] and skip[j]:
            x = meet(spans[i][-1 - trim], arrive[i], spans[j][trim], leave[j])
            if x is not None and np.hypot(*(x - spans[i][-1])) <= 6 * cell:
                tails[i] = heads[j] = x
                cut_tail[i] = cut_head[j] = trim
    out = []
    for n, q in enumerate(spans):
        q = np.vstack([heads[n], q[cut_head[n]:len(q) - cut_tail[n]], tails[n]])
        t0, t1 = leave[n], arrive[n]
        if one_loop:
            r = min(reach, len(q) - 1)
            t0 = unit(q[r] - q[-1 - r])
            t1 = -t0
        fit_span(q, t0, t1, tol, reach, out)
    return out


def is_straight(b, tol):
    """True if a cubic is a straight line within tol, handles included."""
    chord = b[3] - b[0]
    n = np.hypot(*chord)
    if n == 0:                                             # a tiny closed loop as one cubic is not a line
        return False
    d = b[1:3] - b[0]
    off = np.abs(d[:, 0] * chord[1] - d[:, 1] * chord[0]) / n
    along = ((b[1:3] - b[0]) @ chord) / n ** 2
    return off.max() <= tol and along.min() >= 0 and along.max() <= 1


# Colors from chains

def chain_sides(verts, lab):
    """(left, right) labels of a chain walked forward, in Y-up terms. lab is the padded map."""
    Wv = lab.shape[1] + 1
    (r0, c0), (r1, c1) = divmod(int(verts[0]), Wv), divmod(int(verts[1]), Wv)
    if c1 > c0:
        return lab[r0 - 1, c0], lab[r0, c0]
    if c1 < c0:
        return lab[r0, c1], lab[r0 - 1, c1]
    if r1 > r0:
        return lab[r0, c0], lab[r0, c0 - 1]
    return lab[r1, c0 - 1], lab[r1, c0]


def turn_order(incoming, outgoing):
    """Sort key: the sharpest left turn first, which walks around one area at a pinch point."""
    return -np.arctan2(incoming[0] * outgoing[1] - incoming[1] * outgoing[0], incoming @ outgoing)


def stitch(edges):
    """edges: (start vertex, end vertex, cubics, first direction, last direction, traced points), the color
    on the left. Returns closed loops, each (cubics, traced points)."""
    out_at = {}
    for i, e in enumerate(edges):
        out_at.setdefault(e[0], []).append(i)
    used = [False] * len(edges)
    loops = []
    for i in range(len(edges)):
        if used[i]:
            continue
        loop, traced, cur = [], [], i
        while True:
            used[cur] = True
            loop += edges[cur][2]
            traced.append(edges[cur][5])
            options = [j for j in out_at.get(edges[cur][1], []) if not used[j] or j == i]
            if not options:
                break
            cur = min(options, key=lambda j: turn_order(edges[cur][4], edges[j][3]))
            if cur == i:                                   # back at the start: the loop is closed
                break
        loops.append((loop, np.vstack(traced)))
    return loops


def signed_area(q):
    x, y = q[:, 0], q[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def inside(point, q):
    """Even-odd test of one point against a polygon."""
    x, y = point
    a, b = q, np.roll(q, -1, axis=0)
    span = (a[:, 1] > y) != (b[:, 1] > y)
    xs = a[span, 0] + (y - a[span, 1]) * (b[span, 0] - a[span, 0]) / (b[span, 1] - a[span, 1])
    return np.count_nonzero(xs > x) % 2 == 1


def nest(loops):
    """Group loops into areas: [(outer, [holes])]. A color on the left makes outers counterclockwise.
    Direction and nesting come from the traced points, which a loose curve fit cannot turn inside out."""
    flat = [q for _, q in loops]
    area = [signed_area(q) for q in flat]
    outers = sorted((i for i in range(len(loops)) if area[i] > 0), key=lambda i: area[i])
    groups = {i: [] for i in outers}

    def holds(o, q):                                       # three points, as one may sit on a shared pinch
        return sum(inside(q[j], flat[o]) for j in (0, len(q) // 3, 2 * len(q) // 3)) >= 2

    for i, a in enumerate(area):
        if a > 0:
            continue
        home = next((o for o in outers if area[o] > -a and holds(o, flat[i])), None)
        if home is None:                                   # a hole with nothing around it: keep the edge anyway
            groups[i] = []
        else:
            groups[home].append(i)
    return [(loops[o][0], [loops[h][0] for h in holes]) for o, holes in groups.items()]


def chain_line(cubics, straight_tol):
    """A fitted chain as the points verify_svg.py will check, so both judge the same line."""
    parts = [b[:1] if is_straight(b, straight_tol) else bezier_at(b, FLAT) for b in cubics]
    return np.vstack(parts + [cubics[-1][3:4]])


def polyline_cubics(p, closed, tol):
    """The traced points themselves, simplified, as straight cubics."""
    q = np.vstack([p, p[:1]]) if closed else p
    s = approximate_polygon(q, tolerance=tol)
    s = s if len(s) >= (4 if closed else 2) else q
    return [np.array([a, a + (b - a) / 3, b - (b - a) / 3, b]) for a, b in zip(s[:-1], s[1:])]


def build_areas(lab, g, tol_in, corner_deg=40.0):
    """Label map -> ({label: [(outer, holes)]}, (lo, hi)), cubics in inches, Y up."""
    chains, Wv, H = boundary_chains(lab)
    padded = np.pad(lab, 1)
    k = max(int(round(0.004 / g)), 4)
    per_label = {}
    traced = [chain_points(verts, closed, Wv, H, g) for verts, closed in chains]
    every = np.vstack(traced)
    lo, hi = every.min(0), every.max(0)
    # short chains stay close to the trace, or a small area could fold over
    tols = [min(tol_in, np.hypot(*np.diff(p, axis=0).T).sum() / 60) for p in traced]
    fits = [fit_chain(p, c[1], t, k, corner_deg, g) for p, c, t in zip(traced, chains, tols)]
    # as in the DXF, refit whatever crosses: tighter first, then with its corners left as traced, then as
    # the traced polyline, and last as the unsmoothed cell edges, which cannot cross because they all
    # come from one label map. Only the chains in conflict pay for this with extra nodes
    tries = [0] * len(chains)
    for _ in range(12):
        hits = find_crossings([(chain_line(f, tol_in / 4), False) for f in fits])
        if not hits:
            break
        for n in {h[0] for h in hits} | {h[1] for h in hits}:
            tries[n] += 1
            tols[n] = max(tols[n] / 2, g / 8)
            if tries[n] > 4:
                exact = chain_points(chains[n][0], chains[n][1], Wv, H, g, smooth=len(chains[n][0]))
                fits[n] = polyline_cubics(exact, chains[n][1], g / 4)
            elif tries[n] > 3:
                fits[n] = polyline_cubics(traced[n], chains[n][1], g / 4)
            else:
                fits[n] = fit_chain(traced[n], chains[n][1], tols[n], k, corner_deg, g, 3 if tries[n] < 2 else 0)
    for n, (verts, closed) in enumerate(chains):
        p, cubics = traced[n], fits[n]
        left, right = (int(v) for v in chain_sides(verts, padded))
        ends = (verts[0], verts[-1])
        raw = (np.array(divmod(verts[1], Wv)) - divmod(verts[0], Wv), np.array(divmod(verts[-1], Wv)) - divmod(verts[-2], Wv))
        d0, d1 = (np.array([d[1], -d[0]], float) for d in raw)         # (row, col) step -> (x, y) direction
        back = [b[::-1] for b in cubics[::-1]]
        if closed:
            ends = (("loop", n),) * 2
        if left:
            per_label.setdefault(left, []).append((ends[0], ends[1], cubics, d0, d1, p))
        if right:
            per_label.setdefault(right, []).append((ends[1], ends[0], back, -d1, -d0, p[::-1]))
    return {v: nest(stitch(e)) for v, e in per_label.items()}, (lo, hi)


# SVG text

def number(x):
    s = f"{x:.4f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path_data(loop, to_mm, tol_mm):
    pts = [to_mm(b) for b in loop]
    out = [f"M{number(pts[0][0][0])} {number(pts[0][0][1])}"]
    for b in pts:
        if is_straight(b, tol_mm):
            out.append(f"L{number(b[3][0])} {number(b[3][1])}")
        else:
            out.append("C" + " ".join(f"{number(x)} {number(y)}" for x, y in b[1:]))
    return "".join(out) + "Z"


def safe_id(name, taken):
    s = "".join(c if c.isalnum() or c in "-_" else "-" for c in name) or "color"
    s = s if s[0].isalpha() else "c-" + s
    base, n = s, 2
    while s in taken:
        s, n = f"{base}-{n}", n + 1
    taken.add(s)
    return s


def build_svg(lab, g, names, colors, width_in=None, height_in=None, tol_mm=0.02, title="artwork",
              backdrop=None, corner_deg=40.0):
    """Label map -> (SVG text, info). The art fills the width/height box without distortion."""
    areas, (lo, hi) = build_areas(lab, g, tol_mm / MM * 1.0, corner_deg)
    size = hi - lo
    fits = [v for v in (width_in and width_in / size[0], height_in and height_in / size[1]) if v]
    scale = min(fits) if fits else 1.0
    k = scale * MM
    w_mm, h_mm = size * k

    def to_mm(b):
        return np.stack([(b[:, 0] - lo[0]) * k, h_mm - (b[:, 1] - lo[1]) * k], 1)

    w, h = number(w_mm), number(h_mm)
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           f'<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="{w}mm" height="{h}mm" '
           f'viewBox="0 0 {w} {h}">', f"  <title>{escape(title)}</title>"]
    if backdrop:
        out.append(f'  <rect id="backdrop" width="{w}" height="{h}" fill={quoteattr(backdrop)}/>')
    taken, paths, nodes = {"backdrop"}, 0, 0
    for v in sorted(areas):
        fill = "#" + bytes(int(c) for c in colors[v]).hex()
        out.append(f'  <g id={quoteattr(safe_id(names[v], taken))} fill="{fill}" fill-rule="evenodd">')
        for outer, holes in areas[v]:
            out.append(f'    <path d="{"".join(path_data(l, to_mm, tol_mm / 4) for l in [outer] + holes)}"/>')
            paths += 1
            nodes += len(outer) + sum(len(hole) for hole in holes)
        out.append("  </g>")
    out.append("</svg>")
    return "\n".join(out) + "\n", {"size_in": (w_mm / MM, h_mm / MM), "paths": paths, "nodes": nodes, "scale": scale}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("labels", help="labels .npz from make_labels.py, a rebuild script or pipeline.py")
    ap.add_argument("out", help="output .svg")
    ap.add_argument("--width", help="target width with unit: 5in, 127mm, 12.7cm (default: the label map's size)")
    ap.add_argument("--height", help="target height with unit")
    ap.add_argument("--tol-mm", type=float, default=0.02,
                    help="how far a curve may stray from the traced edge at label map size; smaller means more nodes")
    ap.add_argument("--corner-deg", type=float, default=40.0, help="turns sharper than this stay corner nodes")
    ap.add_argument("--backdrop", help="add a full-size rectangle of this #hex color behind the art")
    a = ap.parse_args()
    lab, g, names, colors = load_labels(a.labels)
    title = os.path.splitext(os.path.basename(a.out))[0]
    text, info = build_svg(lab, g, names, colors, parse_length(a.width), parse_length(a.height), a.tol_mm, title,
                           a.backdrop, a.corner_deg)
    with open(a.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"{a.out}: {fmt_size(*info['size_in'])}, {info['paths']} paths, {info['nodes']} curve segments, "
          f"{len(text) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
```

### `scripts/verify_svg.py`

```python
"""Check an SVG before handing it over, and render a preview from the SVG itself.

Checks:
  - structure: width and height in mm matching the viewBox; filled paths only, with no images, text,
    strokes, styles or transforms, so design programs open it the same way
  - every subpath closed; one group per color
  - extents against --width / --height
  - crossings between distinct edges (shared edges count once)
  - with --labels: areas per color against the label map's connected regions; drawn colors against the
    label map, as the largest drift in mm and the share of area; colors overlapping each other

Exit code 1 if any check fails.

Example:
  python verify_svg.py logo.svg --labels labels.npz --width 76mm --preview logo_svg.png
"""
import argparse
import re
import sys
import xml.etree.ElementTree as ET
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from dxf_io import find_crossings, fmt_size, load_labels, parse_length

NS = "{http://www.w3.org/2000/svg}"
TOKEN = re.compile(r"([MCLZ])|(-?\d*\.?\d+)")
ALLOWED = {"svg", "title", "g", "path", "rect"}


def parse_path(d):
    """Path data -> list of subpaths: (segments, closed). A segment is a (4, 2) cubic or (2, 2) line."""
    tokens = TOKEN.findall(d)
    subs, segs, pos, i = [], [], None, 0
    closed = False

    def numbers(count):
        nonlocal i
        vals = [float(t[1]) for t in tokens[i:i + count]]
        i += count
        return np.array(vals).reshape(-1, 2)

    while i < len(tokens):
        cmd = tokens[i][0]
        i += 1
        if cmd == "M":
            if segs:
                subs.append((segs, closed))
            segs, closed = [], False
            pos = numbers(2)[0]
        elif cmd == "L":
            q = numbers(2)[0]
            segs.append(np.array([pos, q]))
            pos = q
        elif cmd == "C":
            q = numbers(6)
            segs.append(np.vstack([pos, q]))
            pos = q[-1]
        elif cmd == "Z":
            closed = bool(segs) and np.abs(segs[0][0] - pos).max() < 1e-6
        else:
            raise ValueError(f"unexpected path token {tokens[i - 1]}")
    if segs:
        subs.append((segs, closed))
    return subs


def flatten_segment(s, per_curve=12):
    """Points along a segment, first included and last left out. Reversed copies give the same points."""
    if len(s) == 2:
        return s[:1]
    u = np.linspace(0, 1, per_curve, endpoint=False)[:, None]
    return (1 - u) ** 3 * s[0] + 3 * u * (1 - u) ** 2 * s[1] + 3 * u ** 2 * (1 - u) * s[2] + u ** 3 * s[3]


def flatten_subpath(segs):
    return np.vstack([flatten_segment(s) for s in segs])


def polygon_area(q):
    """Signed area in mm2. Holes run the other way, so a path's subpaths add up to its filled area."""
    x, y = q[:, 0], q[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def read_svg(text):
    """SVG text -> {w, h, unit problems, groups: [(id, fill, paths)]}, sizes in mm. Paths are lists of subpaths."""
    root = ET.fromstring(text)
    problems = []
    if root.tag != NS + "svg":
        problems.append("root element is not svg")
    sizes = []
    for key in ("width", "height"):
        m = re.fullmatch(r"([\d.]+)mm", root.get(key, ""))
        if not m:
            problems.append(f"{key} is not in mm: {root.get(key)}")
        sizes.append(float(m.group(1)) if m else 0.0)
    box = [float(x) for x in root.get("viewBox", "0 0 0 0").split()]
    if box[:2] != [0, 0] or abs(box[2] - sizes[0]) > 1e-3 or abs(box[3] - sizes[1]) > 1e-3:
        problems.append(f"viewBox {box} does not match the size {sizes}")
    for el in root.iter():
        tag = el.tag.replace(NS, "")
        if tag not in ALLOWED:
            problems.append(f"unexpected element <{tag}>")
        for attr in ("stroke", "style", "transform", "class"):
            if el.get(attr) is not None:
                problems.append(f"<{tag}> has {attr}")
    groups = []
    for g in root.findall(NS + "g"):
        fill = g.get("fill", "")
        if not re.fullmatch(r"#[0-9a-f]{6}", fill):
            problems.append(f"group {g.get('id')} has fill {fill!r}")
        if g.get("fill-rule") != "evenodd":
            problems.append(f"group {g.get('id')} is not evenodd")
        groups.append((g.get("id"), fill, [parse_path(p.get("d", "")) for p in g.findall(NS + "path")]))
    return {"w": sizes[0], "h": sizes[1], "problems": problems, "groups": groups}


def raster(paths, w_px, h_px, px_per_mm):
    """Even-odd fill of paths on a w x h grid, one subpath at a time inside its own window."""
    m = np.zeros((h_px, w_px), bool)
    for path in paths:
        for segs, _ in path:
            q = flatten_subpath(segs) * px_per_mm
            if len(q) < 3:
                continue
            x0, y0 = np.maximum(np.floor(q.min(0)).astype(int) - 1, 0)
            x1, y1 = np.minimum(np.ceil(q.max(0)).astype(int) + 2, (w_px, h_px))
            if x1 <= x0 or y1 <= y0:
                continue
            im = Image.new("1", (int(x1 - x0), int(y1 - y0)), 0)
            ImageDraw.Draw(im).polygon([(float(x - x0), float(y - y0)) for x, y in q], fill=1)
            m[y0:y1, x0:x1] ^= np.array(im)
    return m


def crossing_depth(s, t):
    """How far the two segments reach past each other, in mm: 0 for lines that only touch."""
    reach = []
    for a, b in ((s, t), (t, s)):
        d = a[1] - a[0]
        n = np.hypot(*d)
        reach += [abs((p[0] - a[0][0]) * d[1] - (p[1] - a[0][1]) * d[0]) / n if n else 0.0 for p in b]
    return min(reach)


def real_crossings(edges, depth_mm=0.001):
    """Crossings deeper than depth_mm. The file holds 0.0001 mm and a label cell is about 0.013 mm, so
    anything shallower is rounding at a shared point; a real sliver also fails the overlap and drift checks."""
    return [h for h in find_crossings(edges) if crossing_depth(edges[h[0]][0], edges[h[1]][0]) > depth_mm]


def distinct_edges(doc):
    """Flattened edges as 2-point curves, each counted once however many paths share it."""
    seen = {}
    for _, _, paths in doc["groups"]:
        for path in paths:
            for segs, _ in path:
                q = np.round(flatten_subpath(segs), 6)     # finer than the file, or rounding makes false crossings
                for a, b in zip(q, np.roll(q, -1, axis=0)):
                    ka, kb = tuple(a), tuple(b)
                    if ka != kb:
                        seen.setdefault((min(ka, kb), max(ka, kb)), (a, b))
    return [(np.array(s), False) for s in seen.values()]


def check_svg(text, lab=None, g=None, names=None, width_in=None, height_in=None, tol_mm=0.1, px_per_mm=40.0, preview=None):
    """Run the checks. Returns (ok, list of report lines)."""
    doc = read_svg(text)
    lines = [f"FAIL {p}" for p in doc["problems"]]
    ok = not doc["problems"]
    w, h = doc["w"], doc["h"]
    lines.append(f"size: {fmt_size(w / 25.4, h / 25.4)}")
    for name, want, got in (("width", width_in, w / 25.4), ("height", height_in, h / 25.4)):
        if want and got > want + 0.005:
            lines.append(f"FAIL {name} {got:.3f} in exceeds {want} in")
            ok = False
    open_subs = sum(not c for _, _, paths in doc["groups"] for path in paths for _, c in path)
    paths = sum(len(p) for _, _, p in doc["groups"])
    nodes = sum(len(s) for _, _, ps in doc["groups"] for path in ps for s, _ in path)
    empty = sum(abs(polygon_area(flatten_subpath(s))) < 1e-9 for _, _, ps in doc["groups"] for path in ps for s, _ in path)
    lines += [f"groups: {', '.join(i for i, _, _ in doc['groups'])}", f"paths: {paths}", f"nodes: {nodes}",
              f"open subpaths: {open_subs}", f"empty subpaths: {empty}"]
    if open_subs or empty:
        lines.append(f"FAIL {open_subs} open and {empty} empty subpaths")
        ok = False
    hits = real_crossings(distinct_edges(doc))
    lines.append(f"crossings: {len(hits)}" + (f"  first at ({hits[0][2]:.3f}, {hits[0][3]:.3f}) mm" if hits else ""))
    if hits:
        lines.append(f"FAIL {len(hits)} crossings")
        ok = False

    w_px, h_px = int(np.ceil(w * px_per_mm)), int(np.ceil(h * px_per_mm))
    masks = [raster(p, w_px, h_px, px_per_mm) for _, _, p in doc["groups"]]
    count = np.sum(masks, axis=0)
    overlap = ndimage.binary_opening(count > 1, np.ones((3, 3), bool)).sum() / px_per_mm ** 2
    lines.append(f"overlap between colors: {overlap:.3f} mm2")
    if overlap >= 0.01:
        lines.append("FAIL colors overlap")
        ok = False

    if lab is not None:
        ys, xs = np.nonzero(lab)
        y0, x0, y1, x1 = ys.min(), xs.min(), ys.max() + 1, xs.max() + 1
        cols = np.clip(x0 + ((np.arange(w_px) + 0.5) / (w_px / (x1 - x0))).astype(int), 0, lab.shape[1] - 1)
        rows = np.clip(y0 + ((np.arange(h_px) + 0.5) / (h_px / (y1 - y0))).astype(int), 0, lab.shape[0] - 1)
        under = lab[np.ix_(rows, cols)]
        step = int(np.ceil((x1 - x0) / w_px)) + 2          # label cells across one raster pixel, with a margin
        ids =[v for v in range(1, len(names)) if (lab == v).any()]
        if len(ids) != len(masks):
            lines.append(f"FAIL {len(masks)} groups for {len(ids)} colors in the label map")
            ok = False
        drift = 0.0
        for v, m, (gid, _, gp) in zip(ids, masks, doc["groups"]):
            want = under == v
            # the raster can be coarser than the label grid, so a one-cell sliver can fall between
            # sampled cells: ink counts as placed if the color is anywhere inside its raster pixel
            near = ndimage.maximum_filter(lab == v, size=step)[np.ix_(rows, cols)] | want
            pad, pad_near = np.pad(want, 1), np.pad(near, 1)   # so the raster's edge counts as outside
            lost = want & ~m
            extra = m & ~near
            worst = 0.0
            if lost.any():
                worst = float(ndimage.distance_transform_edt(pad)[1:-1, 1:-1][lost].max())
            if extra.any():
                worst = max(worst, float(ndimage.distance_transform_edt(~pad_near)[1:-1, 1:-1][extra].max()))
            worst /= px_per_mm
            drift = max(drift, worst)
            _, regions = ndimage.label(lab == v)
            cell_mm2 = (w / (x1 - x0)) * (h / (y1 - y0))
            target = int((lab == v).sum()) * cell_mm2
            drawn = sum(abs(sum(polygon_area(flatten_subpath(s)) for s, _ in path)) for path in gp)
            share = 100.0 * abs(drawn - target) / target
            lines.append(f"{gid}: {len(gp)} areas, {regions} regions in the label map, area off by {share:.2f}%, "
                         f"drift {worst:.3f} mm")
            if len(gp) != regions:
                lines.append(f"FAIL {gid}: {len(gp)} areas for {regions} regions")
                ok = False
            if share > 2.0:
                lines.append(f"FAIL {gid}: area off by {share:.2f}%")
                ok = False
        lines.append(f"largest drift: {drift:.3f} mm")
        if drift > tol_mm:
            lines.append(f"FAIL drift over {tol_mm} mm")
            ok = False

    if preview:
        img = np.full((h_px, w_px, 3), 45, np.uint8)          # dark, so white parts show
        for m, (_, fill, _) in zip(masks, doc["groups"]):
            img[m] = tuple(bytes.fromhex(fill[1:]))
        im = Image.fromarray(img)
        if w_px > 2400:
            im = im.resize((2400, round(h_px * 2400 / w_px)), Image.LANCZOS)
        im.save(preview)
        lines.append(f"preview: {preview}")
    return ok, lines


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("svg")
    ap.add_argument("--labels", help="labels .npz the SVG was made from")
    ap.add_argument("--width", help="requested width with unit")
    ap.add_argument("--height", help="requested height with unit")
    ap.add_argument("--max-drift-mm", type=float, default=0.1, help="largest allowed distance from the label map")
    ap.add_argument("--preview", help="write a PNG preview rendered from the SVG")
    a = ap.parse_args()
    lab = g = names = None
    if a.labels:
        lab, g, names, _ = load_labels(a.labels)
    text = open(a.svg, encoding="utf-8").read()
    ok, lines = check_svg(text, lab, g, names, parse_length(a.width), parse_length(a.height), a.max_drift_mm,
                          preview=a.preview)
    print("\n".join(lines))
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
```

### `scripts/mesh3mf.py`

```python
"""Polygons to watertight meshes, and meshes to 3MF.

No third-party mesh libraries: polygons with holes are triangulated by hole bridging plus ear
clipping, extruded into closed prisms, and written as a core-spec 3MF (millimetres) that Bambu
Studio, Orca Slicer and its forks, PrusaSlicer and Cura open.

3MF layout: one mesh object per part (named, with a display color from a basematerials group),
grouped under one parent object made of components, so slicers load it as ONE object with named
parts. Metadata/model_settings.config (the Bambu Studio / Orca Slicer convention) assigns part k
to filament k + 1, so each material lands on its own filament slot.
"""
import zipfile
import xml.etree.ElementTree as ET
import numpy as np

# ---------- polygon helpers (all 2D, millimetres) ----------


def signed_area(p):
    x, y = p[:, 0], p[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def point_in_poly(pt, poly):
    """Even-odd test of one point against one closed polygon."""
    x, y = pt
    xs, ys = poly[:, 0], poly[:, 1]
    xn, yn = np.roll(xs, -1), np.roll(ys, -1)
    cross = (ys > y) != (yn > y)
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = xs + (y - ys) * (xn - xs) / (yn - ys)
    return bool(np.count_nonzero(cross & (x < xi)) % 2)


def clean_loop(p, tol=1e-7):
    """Drop repeated points and points in a straight line with their neighbours (they give zero-area
    triangles). tol is twice the triangle area in mm2."""
    p = np.asarray(p, float)
    changed = True
    while changed and len(p) > 3:
        changed = False
        q = np.roll(p, -1, axis=0)
        keep = np.linalg.norm(q - p, axis=1) > 1e-9
        if not keep.all():
            p, changed = p[keep], True
            continue
        a, c = np.roll(p, 1, axis=0), np.roll(p, -1, axis=0)
        cr = np.abs((p[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (p[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0]))
        flat = cr <= tol
        if flat.any():
            flat &= ~np.roll(flat, 1)            # never drop two neighbours in one pass
            p, changed = p[~flat], True
    return p


def nest_loops(loops):
    """Group closed loops into regions: [(outer, [holes...]), ...], outer CCW and holes CW.
    A loop's depth is how many other loops contain it; even depth = outer, odd = hole."""
    loops = [clean_loop(l) for l in loops]
    loops = [l for l in loops if len(l) >= 3 and abs(signed_area(l)) > 1e-9]
    n = len(loops)
    areas = [abs(signed_area(l)) for l in loops]
    inside = np.zeros((n, n), bool)            # inside[i, j]: loop i lies inside loop j
    for i in range(n):
        probe = loops[i][0]
        for j in range(n):
            if i != j and areas[j] > areas[i] and point_in_poly(probe, loops[j]):
                inside[i, j] = True
    depth = inside.sum(1)
    regions = {}
    for i in np.argsort(depth):
        if depth[i] % 2 == 0:
            regions[i] = []
    for i in range(n):
        if depth[i] % 2 == 1:                   # parent = the smallest containing outer
            parents = [j for j in range(n) if inside[i, j] and depth[j] == depth[i] - 1]
            if parents:
                regions[min(parents, key=lambda j: areas[j])].append(i)
    out = []
    for o, hs in regions.items():
        outer = loops[o] if signed_area(loops[o]) > 0 else loops[o][::-1]
        holes = [loops[h] if signed_area(loops[h]) < 0 else loops[h][::-1] for h in hs]
        out.append((outer, holes))
    return out


def _cross(o, a, b):
    return (a[..., 0] - o[..., 0]) * (b[..., 1] - o[..., 1]) - (a[..., 1] - o[..., 1]) * (b[..., 0] - o[..., 0])


def _in_cone(prev, v, nxt, x):
    """Is point x inside the interior angle of a CCW polygon at vertex v (O'Rourke's InCone)?"""
    if _cross(v, nxt, prev) >= 0:                       # convex vertex
        return _cross(v, x, prev) > 0 and _cross(x, v, nxt) > 0
    return not (_cross(v, x, nxt) >= 0 and _cross(x, v, prev) >= 0)


def bridge_holes(outer, holes):
    """Join holes into the outer loop with zero-width bridges (Eberly). Returns (points, ids) where
    ids index the original vertices (outer first, then each hole in order), so duplicates share ids."""
    pts = [tuple(p) for p in outer]
    ids = list(range(len(outer)))
    base = len(outer)
    hole_info = []
    for h in holes:
        hole_info.append((h, base))
        base += len(h)
    hole_info.sort(key=lambda t: -t[0][:, 0].max())
    for h, off in hole_info:
        m = int(np.argmax(h[:, 0]))
        M = h[m]
        P = np.array(pts)
        A, B = P, np.roll(P, -1, axis=0)
        best_x, best_k = np.inf, None
        for k in range(len(P)):                # nearest edge hit by a ray from M toward +x
            a, b = A[k], B[k]
            if (a[1] > M[1]) == (b[1] > M[1]):
                continue
            if a[1] == b[1]:
                continue
            x = a[0] + (M[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if M[0] <= x < best_x:
                best_x, best_k = x, k
        if best_k is None:
            raise ValueError("hole bridging failed: hole not inside outer loop")
        a, b = A[best_k], B[best_k]
        k = best_k if a[0] >= b[0] else (best_k + 1) % len(P)
        Ppt = P[k]
        I = np.array([best_x, M[1]])
        # a reflex vertex inside triangle (M, I, P) blocks the bridge: take the one closest in angle
        nxt, prv = np.roll(P, -1, axis=0), np.roll(P, 1, axis=0)
        reflex = _cross(prv, P, nxt) < 0
        tri = [M, I, Ppt] if _cross(M, I, Ppt) > 0 else [M, Ppt, I]
        c1, c2, c3 = _cross(tri[0], tri[1], P), _cross(tri[1], tri[2], P), _cross(tri[2], tri[0], P)
        inside = reflex & (c1 >= 0) & (c2 >= 0) & (c3 >= 0) & ~np.all(P == Ppt, axis=1)
        if abs(_cross(M, I, Ppt)) <= 1e-12:
            # the ray hit the vertex itself: it is visible. (The triangle is flat, and a flat triangle
            # would count every point on that line as inside, sending the bridge through the vertex.)
            inside[:] = False
        if inside.any():
            cand = np.nonzero(inside)[0]
            d = P[cand] - M
            ang = np.abs(np.arctan2(d[:, 1], d[:, 0]))
            k = int(cand[np.lexsort((np.hypot(d[:, 0], d[:, 1]), ang))[0]])
        # the target point may appear several times (earlier bridges end there too): use the copy
        # whose interior angle contains the direction to M, or the new bridge interleaves wrongly
        copies = np.nonzero(np.all(P == P[k], axis=1))[0]
        if len(copies) > 1:
            k = next((int(c) for c in copies if _in_cone(P[(c - 1) % len(P)], P[c], P[(c + 1) % len(P)], M)),
                     int(k))
        hole_seq = [tuple(h[(m + j) % len(h)]) for j in range(len(h))] + [tuple(M)]
        hole_ids = [off + (m + j) % len(h) for j in range(len(h))] + [off + m]
        pts = pts[:k + 1] + hole_seq + pts[k:]
        ids = ids[:k + 1] + hole_ids + ids[k:]
    return np.array(pts, float), ids


def ear_clip(P):
    """Triangulate a CCW, weakly simple polygon (bridged holes allowed). Returns index triples
    into P, and how many ears had to be forced (0 for a clean polygon)."""
    n = len(P)
    if n < 3:
        return [], 0
    prev = np.array([(i - 1) % n for i in range(n)])
    nxt = np.array([(i + 1) % n for i in range(n)])
    alive = np.ones(n, bool)
    eps = 1e-12

    def is_reflex(i):
        return _cross(P[prev[i]], P[i], P[nxt[i]]) <= eps

    reflex = np.array([is_reflex(i) for i in range(n)])
    tris, forced, remaining, i, stall, relaxed = [], 0, n, 0, 0, False
    while remaining > 3:
        p, q = prev[i], nxt[i]
        ear = False
        if not reflex[i]:
            cand = np.nonzero(alive & reflex)[0]
            cand = cand[(cand != p) & (cand != q) & (cand != i)]
            if len(cand):
                C = P[cand]
                same = (np.all(C == P[p], 1) | np.all(C == P[i], 1) | np.all(C == P[q], 1))
                C = C[~same]
                # strict mode: a vertex on the triangle's edge blocks the ear; relaxed mode lets it
                # pass (bridged holes put duplicate vertices on candidate edges)
                lim = eps if relaxed else -eps
                c1, c2, c3 = _cross(P[p], P[i], C), _cross(P[i], P[q], C), _cross(P[q], P[p], C)
                inside = (c1 > lim) & (c2 > lim) & (c3 > lim) if relaxed else (c1 >= lim) & (c2 >= lim) & (c3 >= lim)
                ear = not inside.any()
            else:
                ear = True
        if not ear and stall > remaining:
            if not relaxed:                    # a full lap with no ear: retry with the relaxed test
                relaxed, stall = True, 0
                continue
            live = np.nonzero(alive)[0]        # still stuck: clip the most convex vertex
            conv = np.array([_cross(P[prev[j]], P[j], P[nxt[j]]) for j in live])
            i = int(live[np.argmax(conv)])
            p, q = prev[i], nxt[i]
            ear, forced = True, forced + 1
        if ear:
            tris.append((p, i, q))
            alive[i] = False
            nxt[p], prev[q] = q, p
            remaining -= 1
            reflex[p], reflex[q] = is_reflex(p), is_reflex(q)
            i, stall, relaxed = q, 0, False
        else:
            i, stall = nxt[i], stall + 1
    live = np.nonzero(alive)[0]
    a = live[0]
    tris.append((prev[a], a, nxt[a]))
    return tris, forced


def fix_slivers(tris, pts, tol=1e-9):
    """Remove zero-area triangles from a 2D triangulation by edge flips: a sliver (a, b, c) with b on
    edge a-c is merged with the triangle across a-c, (a, c, d), and re-split as (a, b, d), (b, c, d).
    The surface stays closed (just dropping the sliver would leave a crack)."""
    tris = [tuple(t) for t in tris]
    for _ in range(4 * len(tris) + 1):
        bad = None
        cr = np.abs(_cross(pts[[t[0] for t in tris]], pts[[t[1] for t in tris]], pts[[t[2] for t in tris]])) \
            if tris else np.zeros(0)
        for k in np.nonzero(cr <= tol)[0]:
            a, b, c = tris[k]
            if len({a, b, c}) == 3:
                bad = k
                break
        if bad is None:
            return tris
        a, b, c = tris[bad]
        # rotate so that b is the middle point (lies between a and c)
        for _ in range(3):
            if np.dot(pts[a] - pts[b], pts[c] - pts[b]) <= 0:
                break
            a, b, c = b, c, a
        # the sliver runs c -> a along its long edge, so the triangle across holds a -> c
        mate = next((k for k, t in enumerate(tris) if k != bad and
                     any(t[i] == a and t[(i + 1) % 3] == c for i in range(3))), None)
        if mate is None:                          # sliver on the boundary: nothing across, drop it
            tris.pop(bad)
            continue
        t = tris[mate]
        i = next(i for i in range(3) if t[i] == a and t[(i + 1) % 3] == c)
        d = t[(i + 2) % 3]
        for k in sorted((bad, mate), reverse=True):
            tris.pop(k)
        tris += [(a, b, d), (b, c, d)]
    return tris


def resolve_touching(loops, tol=1e-6):
    """Where a vertex of one loop lies on an edge of another (a hole touching the outline at a point),
    insert it into that edge too, so the two loops share the point instead of forming a T-junction."""
    out = [np.asarray(l, float) for l in loops]
    for i in range(len(out)):
        for j in range(len(out)):
            if i == j:
                continue
            A = out[j]
            B = np.roll(A, -1, axis=0)
            lo = np.minimum(A, B) - tol
            hi = np.maximum(A, B) + tol
            inserts = {}
            for v in out[i]:
                cand = np.nonzero(np.all((v >= lo) & (v <= hi), axis=1))[0]
                for k in cand:
                    a, b = A[k], B[k]
                    ab = b - a
                    L2 = ab @ ab
                    if L2 == 0:
                        continue
                    t = ((v - a) @ ab) / L2
                    if not (1e-9 < t < 1 - 1e-9):
                        continue
                    if abs(ab[0] * (v[1] - a[1]) - ab[1] * (v[0] - a[0])) / np.sqrt(L2) < tol:
                        inserts.setdefault(int(k), []).append((t, v.copy()))
            if inserts:
                newl = []
                for k in range(len(A)):
                    newl.append(A[k])
                    for _, v in sorted(inserts.get(k, []), key=lambda e: e[0]):
                        newl.append(v)
                out[j] = np.array(newl)
    return out


def extrude(regions, z0, z1):
    """Closed prisms for regions [(outer CCW, [holes CW])]. Returns (vertices Nx3, triangles Mx3, forced)."""
    V, T, forced = [], [], 0
    for outer, holes in regions:
        loops = resolve_touching([outer] + list(holes))
        outer, holes = loops[0], loops[1:]
        flat = np.vstack(loops)
        nv = len(flat)
        # triangulate in a slightly rotated frame: outlines traced from pixels have many exactly
        # horizontal edges at equal heights, which the horizontal bridge ray would hit exactly.
        # The triangles index the same points, so the real geometry is untouched.
        rot = np.array([[np.cos(0.6180339), -np.sin(0.6180339)], [np.sin(0.6180339), np.cos(0.6180339)]])
        P, ids = bridge_holes(outer @ rot.T, [hh @ rot.T for hh in holes])
        tris, f = ear_clip(P)
        forced += f
        ids = np.array(ids)
        # work in unique-vertex ids so bridge duplicates are one vertex, then flip away slivers
        tris = [(ids[a], ids[b], ids[c]) for a, b, c in tris if len({ids[a], ids[b], ids[c]}) == 3]
        # slivers judged on the coordinates as written to the file (6 decimals, 0.000001 mm); at
        # 4 decimals nearly aligned points became exactly aligned and the flips misjudged sides
        tris = fix_slivers(tris, np.round(flat, 6), tol=1e-12)
        base = sum(x.shape[0] for x in V)
        V.append(np.hstack([flat, np.full((nv, 1), z0)]))      # bottom ring: base .. base+nv-1
        V.append(np.hstack([flat, np.full((nv, 1), z1)]))      # top ring: base+nv ..
        bot, top = base, base + nv
        for ia, ib, ic in tris:
            T.append((top + ia, top + ib, top + ic))           # top faces up (CCW)
            T.append((bot + ia, bot + ic, bot + ib))           # bottom faces down
        start = 0
        for l in loops:                                        # walls, outward (interior is on the left)
            k = len(l)
            for j in range(k):
                a, b = start + j, start + (j + 1) % k
                T.append((bot + a, bot + b, top + b))
                T.append((bot + a, top + b, top + a))
            start += k
    if not V:
        return np.zeros((0, 3)), np.zeros((0, 3), int), 0
    return np.vstack(V), np.array(T, int), forced


# ---------- mesh checks ----------


def mesh_check(V, T):
    """Watertight and consistently oriented: every directed edge appears once and its reverse once."""
    e = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    key = e[:, 0].astype(np.int64) * (len(V) + 1) + e[:, 1]
    rkey = e[:, 1].astype(np.int64) * (len(V) + 1) + e[:, 0]
    uniq, counts = np.unique(key, return_counts=True)
    dup = int((counts > 1).sum())
    unmatched = int((~np.isin(key, rkey)).sum())
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    vol = float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)
    nrm = np.cross(b - a, c - a)
    area2 = np.linalg.norm(nrm, axis=1)
    folded = count_folded(V, T, nrm, area2)
    return {"triangles": int(len(T)), "open_edges": unmatched, "duplicate_edges": dup,
            "volume_mm3": vol, "degenerate": int((area2 < 1e-12).sum()), "folded": folded,
            "watertight": unmatched == 0 and dup == 0 and vol > 0 and folded == 0}


def count_folded(V, T, nrm, area2):
    """Folded cap triangles: in each shell (a connected piece of the mesh), every flat face on the
    shell's top level must face up and every flat face on its bottom level must face down. A folded
    triangle faces the wrong way, and its overlap is hidden in the volume and area totals."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    n = len(V)
    rows = np.concatenate([T[:, 0], T[:, 1], T[:, 2]])
    cols = np.concatenate([T[:, 1], T[:, 2], T[:, 0]])
    _, comp = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)), directed=False)
    tcomp = comp[T[:, 0]]
    z = V[T][:, :, 2]
    flat = np.isclose(z[:, 0], z[:, 1]) & np.isclose(z[:, 1], z[:, 2]) & (area2 > 1e-12)
    bad = 0
    for c in np.unique(tcomp):
        m = tcomp == c
        zs = V[np.unique(T[m])][:, 2]
        top, bot = zs.max(), zs.min()
        at_top = m & flat & np.isclose(z[:, 0], top)
        at_bot = m & flat & np.isclose(z[:, 0], bot)
        bad += int((nrm[at_top, 2] < 0).sum() + (nrm[at_bot, 2] > 0).sum())
    return bad


# ---------- 3MF ----------

NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
MAT = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02"


def write_3mf(path, parts, title="part", project=None, center=None):
    """parts: list of dicts {name, color (r, g, b), V (Nx3 mm), T (Mx3)}. One parent object, one part each.
    project: optional Bambu project settings dict (bambu_profile.project_settings). With it the file
    says it comes from Bambu Studio, so Bambu Studio loads the printer, process and one filament per
    part; without it the file is plain 3MF and Bambu Studio loads geometry only.
    center: (x, y) bed point to place the plate's centre on (Bambu beds start at the front-left corner)."""
    app = f"BambuStudio-{project['version']}" if project else "png2cad"
    out = [f'<?xml version="1.0" encoding="UTF-8"?>',
           f'<model unit="millimeter" xml:lang="en-US" xmlns="{NS}" xmlns:m="{MAT}">',
           f' <metadata name="Title">{title}</metadata>',
           f' <metadata name="Application">{app}</metadata>']
    if project:
        out.append(' <metadata name="BambuStudio:3mfVersion">1</metadata>')
    out += [
           ' <resources>',
           '  <basematerials id="1">']
    for p in parts:
        r, g, b = p["color"]
        out.append(f'   <base name="{p["name"]}" displaycolor="#{r:02X}{g:02X}{b:02X}FF"/>')
    out.append('  </basematerials>')
    for k, p in enumerate(parts):
        oid = k + 2
        out.append(f'  <object id="{oid}" type="model" name="{p["name"]}" pid="1" pindex="{k}">')
        out.append('   <mesh>')
        out.append('    <vertices>')
        out += [f'     <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>' for x, y, z in p["V"]]
        out.append('    </vertices>')
        out.append('    <triangles>')
        out += [f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in p["T"]]
        out.append('    </triangles>')
        out.append('   </mesh>')
        out.append('  </object>')
    parent = len(parts) + 2
    out.append(f'  <object id="{parent}" type="model" name="{title}">')
    out.append('   <components>')
    out += [f'    <component objectid="{k + 2}"/>' for k in range(len(parts))]
    out.append('   </components>')
    out.append('  </object>')
    out.append(' </resources>')
    out.append(' <build>')
    if center is not None:
        allv = np.vstack([p["V"] for p in parts])
        mid = (allv.min(0) + allv.max(0)) / 2
        tx, ty = center[0] - mid[0], center[1] - mid[1]
        out.append(f'  <item objectid="{parent}" transform="1 0 0 0 1 0 0 0 1 {tx:.6f} {ty:.6f} {-allv[:, 2].min():.6f}" printable="1"/>')
    else:
        out.append(f'  <item objectid="{parent}"/>')
    out.append(' </build>')
    out.append('</model>')
    ctypes = ('<?xml version="1.0" encoding="UTF-8"?>\n'
              '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
              ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
              ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
              '</Types>\n')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
            ' <Relationship Target="/3D/3dmodel.model" Id="rel0" '
            'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n'
            '</Relationships>\n')
    ident = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"
    cfg = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>', f'  <object id="{parent}">',
           f'    <metadata key="name" value="{title}"/>', '    <metadata key="extruder" value="1"/>']
    for k, p in enumerate(parts):
        cfg += [f'    <part id="{k + 2}" subtype="normal_part">',
                f'      <metadata key="name" value="{p["name"]}"/>',
                f'      <metadata key="matrix" value="{ident}"/>',
                f'      <metadata key="extruder" value="{k + 1}"/>',
                '    </part>']
    cfg += ['  </object>', '</config>']
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ctypes)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", "\n".join(out) + "\n")
        z.writestr("Metadata/model_settings.config", "\n".join(cfg) + "\n")
        if project:
            import json
            z.writestr("Metadata/project_settings.config", json.dumps(project, indent=4) + "\n")


def read_3mf(path):
    """Read parts back: list of {name, color, V, T, extruder}, following the build item and its
    components; extruder comes from Metadata/model_settings.config when present."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for req in ("[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"):
            if req not in names:
                raise ValueError(f"missing {req}")
        root = ET.fromstring(z.read("3D/3dmodel.model"))
        cfg = ET.fromstring(z.read("Metadata/model_settings.config")) if "Metadata/model_settings.config" in names else None
    ext = {}
    if cfg is not None:
        for part in cfg.iter("part"):
            for md in part.findall("metadata"):
                if md.get("key") == "extruder":
                    ext[part.get("id")] = int(md.get("value"))
    ns = {"c": NS}
    mats = {}
    for bm in root.iter(f"{{{NS}}}basematerials"):
        mats[bm.get("id")] = [b.get("displaycolor") for b in bm.findall("c:base", ns)]
    objs = {o.get("id"): o for o in root.iter(f"{{{NS}}}object")}
    item = root.find("c:build/c:item", ns)
    parent = objs[item.get("objectid")]
    comps = parent.findall("c:components/c:component", ns)
    targets = [objs[c.get("objectid")] for c in comps] if comps else [parent]
    parts = []
    for o in targets:
        vs = o.findall("c:mesh/c:vertices/c:vertex", ns)
        ts = o.findall("c:mesh/c:triangles/c:triangle", ns)
        V = np.array([[float(v.get("x")), float(v.get("y")), float(v.get("z"))] for v in vs])
        T = np.array([[int(t.get("v1")), int(t.get("v2")), int(t.get("v3"))] for t in ts])
        col = mats.get(o.get("pid"), [None])[int(o.get("pindex", 0))] if o.get("pid") else None
        parts.append({"name": o.get("name"), "color": col, "V": V, "T": T, "extruder": ext.get(o.get("id"))})
    return parts, item.get("objectid"), parent.get("name")
```

### `scripts/bambu_profile.py`

```python
"""Build a Bambu Studio project settings file (Metadata/project_settings.config) from Bambu's own
system presets, so a plate opens in Bambu Studio as a project: printer, process and N filaments
already loaded, each part on its own filament, in the plate's colors.

Why: Bambu Studio 2.8.2+ refuses the settings of any 3MF without a printer configuration ("The 3mf
file has invalid config, load geometry data only") and then never adds the extra filament slots, so
the parts all land on filament 1. A file whose settings name a Bambu Lab printer_model is accepted.

Presets come from a Bambu Studio profile folder (resources/profiles/BBL in an install, or
%APPDATA%/BambuStudio/system/BBL). Each preset is resolved through its "inherits" chain and
"include" templates, the way Bambu Studio does, then the three are merged into one flat config.

    from bambu_profile import project_settings
    cfg = project_settings(profile_dir, "Bambu Lab X1 Carbon", 0.4, ["#A0A0A0", "#FFFFFF"])
"""
import json
import os

DEFAULT_PRINTER = "Bambu Lab X1 Carbon"
# per nozzle: the Bambu "Standard" process whose layer is half the nozzle (the inset assumes that)
PROCESS_FOR_NOZZLE = {0.2: "0.10mm Standard @BBL {short} 0.2 nozzle", 0.4: "0.20mm Standard @BBL {short}",
                      0.6: "0.30mm Standard @BBL {short} 0.6 nozzle", 0.8: "0.40mm Standard @BBL {short} 0.8 nozzle"}
FILAMENT_FOR_NOZZLE = {0.4: "Bambu PLA Basic @BBL {short}"}
FILAMENT_OTHER = "Bambu PLA Basic @BBL {short} {n:g} nozzle"
SHORT = {"Bambu Lab X1 Carbon": "X1C", "Bambu Lab X1": "X1", "Bambu Lab X1E": "X1E", "Bambu Lab P1S": "P1S",
         "Bambu Lab P1P": "P1P", "Bambu Lab A1": "A1", "Bambu Lab A1 mini": "A1M", "Bambu Lab P2S": "P2S"}


class Profiles:
    def __init__(self, root):
        self.root = root
        self.index = {}
        for sub in ("machine", "process", "filament"):
            d = os.path.join(root, sub)
            for dirpath, _, files in os.walk(d):
                for f in files:
                    if f.endswith(".json"):
                        try:
                            name = json.load(open(os.path.join(dirpath, f), encoding="utf-8")).get("name")
                        except (ValueError, UnicodeDecodeError):
                            continue
                        if name:
                            self.index[(sub, name)] = os.path.join(dirpath, f)

    def resolve(self, kind, name):
        """Flat dict for a preset: parents first, then includes, then the preset's own keys."""
        path = self.index.get((kind, name))
        if path is None:
            raise KeyError(f"no {kind} preset named '{name}' in {self.root}")
        own = json.load(open(path, encoding="utf-8"))
        out = self.resolve(kind, own["inherits"]) if own.get("inherits") else {}
        for inc in own.get("include", []) or []:
            out.update({k: v for k, v in self.resolve(kind, inc).items() if k not in META})
        out.update(own)
        return out


META = {"name", "inherits", "from", "instantiation", "include", "type", "setting_id", "filament_id",
        "description", "renamed_from", "version", "is_custom_defined", "base_id"}


def preset_names(printer, nozzle):
    short = SHORT.get(printer)
    if short is None:
        raise SystemExit(f"--printer: no preset names known for '{printer}' (known: {', '.join(SHORT)})")
    n = round(float(nozzle), 1)
    machine = f"{printer} {n:g} nozzle"
    process = PROCESS_FOR_NOZZLE.get(n, "").format(short=short)
    filament = (FILAMENT_FOR_NOZZLE.get(n) or FILAMENT_OTHER).format(short=short, n=n)
    return machine, process, filament


def project_settings(profile_dir, printer, nozzle, colors, version="02.08.00.00"):
    """colors: '#RRGGBB' per filament, in filament order. Returns the settings as a dict that
    json.dump writes in Bambu's own project_settings.config format."""
    prof = Profiles(profile_dir)
    machine_name, process_name, filament_name = preset_names(printer, nozzle)
    machine = prof.resolve("machine", machine_name)
    process = prof.resolve("process", process_name)
    fil = prof.resolve("filament", filament_name)
    fil_id = json.load(open(prof.index[("filament", filament_name)], encoding="utf-8")).get("filament_id") \
        or fil.get("filament_id", "")
    n = len(colors)
    cfg = {}
    for src in (process, machine):
        cfg.update({k: v for k, v in src.items() if k not in META})
    # filament keys: every list repeated once per filament (Bambu stores one entry per filament)
    for k, v in fil.items():
        if k in META or k in ("compatible_printers", "compatible_prints", "compatible_printers_condition",
                              "compatible_prints_condition"):
            continue
        cfg[k] = (v * n) if isinstance(v, list) else v
    cfg.update({
        "filament_colour": [c.upper() for c in colors],
        "filament_settings_id": [filament_name] * n,
        "filament_ids": [fil_id] * n,
        "filament_self_index": [str(i + 1) for i in range(n) for _ in range(max(1, len(fil.get("filament_extruder_variant", ["x"]))))],
        "filament_map": ["1"] * n,
        "print_settings_id": process_name,
        "printer_settings_id": machine_name,
        "printer_model": machine.get("printer_model", printer),
        "inherits_group": [process_name] + [filament_name] * n + [machine_name],
        "different_settings_to_system": [""] * (n + 2),
        "from": "project",
        "name": "project_settings",
        "version": version,
    })
    for k in ("compatible_printers", "compatible_prints", "compatible_printers_condition",
              "compatible_prints_condition", "inherits"):
        cfg.pop(k, None)
    return cfg
```

### `scripts/labels_to_3mf.py`

```python
"""Turn a label map into a ready-to-slice 3MF test plate for Bambu Studio, Orca Slicer and its forks.

Styles:
  inset (default)  the design is inlaid flush into the top of a plate, --inset depth deep. The plate
                   (the "body") is a separate rectangle for one-color art (the truck: 2 materials), or
                   one of the design's own colors for multi-color art (the shield: 3 materials, no
                   extra base). The body color defaults to the color along the art's outer edge;
                   --body overrides
  relief           a base plate with the artwork raised on top (base + one part per color)
  flat             each color is a full-height part, no base: a multi-color tile

Heights: inset depth defaults to 10 layers of half the nozzle diameter (0.4 mm nozzle -> 0.2 mm
layers -> 2.0 mm). Override with --inset-mm, or --inset-layers / --layer-mm. --base-mm is the solid
plate under the inset.

Materials: every part is one material. Parts are assigned filaments 1..N in the file
(Metadata/model_settings.config, the Bambu Studio / Orca convention) and carry display colors.
--materials N makes the run fail if the design does not come out at exactly N.

Bambu Studio project (--bambu, on by default when Bambu's presets are found): the file also carries
a Bambu printer/process/filament configuration built from Bambu's own presets for --printer and the
nozzle, so Bambu Studio opens it with N filaments in the plate's colors, each part on its filament,
centred on the bed. Without it Bambu Studio 2.8.2+ says "invalid config, load geometry data only"
and leaves every part on filament 1. Presets are read from --bambu-profiles, $BAMBU_PROFILES,
%APPDATA%/BambuStudio/system/BBL or ~/.config/BambuStudio/system/BBL.

Example:
  python labels_to_3mf.py labels_n0.4.npz part_n0.4.3mf --nozzle-mm 0.4
"""
import argparse
import os
import numpy as np

from dxf_io import load_labels
from labels_to_dxf import boundary_chains, chains_to_curves
from mesh3mf import nest_loops, extrude, write_3mf, mesh_check

MM = 25.4


def join_diagonals(mask):
    """Where two cells touch only at a corner, fill one of the other two cells so the outline does
    not pinch to a point (each fix moves one grid cell)."""
    m = mask.copy()
    a, b, c, d = m[:-1, :-1], m[:-1, 1:], m[1:, :-1], m[1:, 1:]
    diag1 = a & d & ~b & ~c
    diag2 = b & c & ~a & ~d
    m[:-1, 1:] |= diag1
    m[:-1, :-1] |= diag2
    return m


def mask_loops(mask, g, tol_in, shift_cells=0):
    """Closed outline loops (inches) of a boolean mask. shift_cells: the mask was padded by this many
    cells, so coordinates are shifted back to the unpadded map's frame."""
    ch, Wv, H = boundary_chains(join_diagonals(mask).astype(np.uint8))
    curves = chains_to_curves(ch, Wv, H, g, tol_in)
    return [p - shift_cells * g for p, closed in curves if closed and len(p) >= 3]


def outer_edge_label(lab):
    """The color that runs along most of the art's outer edge (the natural body color)."""
    fg = lab != 0
    pad = np.pad(fg, 1)
    edge = fg & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    vals = lab[edge]
    return int(np.bincount(vals[vals > 0]).argmax())


def layer_heights(nozzle_mm=0.4, layer_mm=None, inset_layers=10, inset_mm=None):
    layer = layer_mm or nozzle_mm / 2.0
    depth = inset_mm if inset_mm else inset_layers * layer
    return layer, depth


def build_parts(lab, g, names, colors, style="inset", base_mm=1.2, relief_mm=0.6, base_shape="auto",
                margin_mm=2.0, base_color=(160, 160, 160), tol_in=0.0005, inset_mm=2.0, body="auto"):
    """Parts in filament order (part k gets filament k + 1)."""
    feats = [v for v in range(1, len(names)) if (lab == v).any()]
    raw = {v: mask_loops(lab == v, g, tol_in) for v in feats}
    allpts = np.vstack([np.vstack(l) for l in raw.values()])
    origin = allpts.min(0)                       # art's bottom-left at 0,0 (as in the DXFs)
    to_mm = lambda loops: [(l - origin) * MM for l in loops]
    color = lambda v: tuple(int(c) for c in colors[v])
    parts = []

    def add(name, col, shells):
        Vs, Ts, f, off = [], [], 0, 0
        for regions, z0, z1 in shells:          # several closed shells may make up one material
            V, T, ff = extrude(nest_loops(regions), z0, z1)
            if len(V):
                Vs.append(V)
                Ts.append(T + off)
                off += len(V)
            f += ff
        parts.append({"name": name, "color": col, "V": np.vstack(Vs), "T": np.vstack(Ts), "forced": f})

    if style == "flat":
        for v in feats:
            add(names[v], color(v), [(to_mm(raw[v]), 0.0, base_mm + relief_mm)])
        return parts

    shape = base_shape if base_shape != "auto" else ("rect" if len(feats) == 1 else "footprint")
    if style == "relief":
        if shape == "rect":
            w, h = (allpts.max(0) - origin) * MM
            mg = margin_mm
            base_loops = [np.array([[-mg, -mg], [w + mg, -mg], [w + mg, h + mg], [-mg, h + mg]])]
        else:
            base_loops = to_mm(mask_loops(lab != 0, g, tol_in))
        add("base", tuple(base_color), [(base_loops, 0.0, base_mm)])
        for v in feats:
            add(names[v], color(v), [(to_mm(raw[v]), base_mm, base_mm + relief_mm)])
        return parts

    # inset: body = slab under everything + the body's own areas in the top layer; the rest inlaid
    top0, top1 = base_mm, base_mm + inset_mm
    if shape == "rect":
        pad = int(round(margin_mm / MM / g))
        L = np.pad(lab, pad)
        slab = to_mm(mask_loops(np.ones_like(L, bool), g, tol_in, pad))
        top = to_mm(mask_loops(L == 0, g, tol_in, pad))
        add("base", tuple(base_color), [(slab, 0.0, top0), (top, top0, top1)])
        inlaid = feats
    else:
        b = outer_edge_label(lab) if body == "auto" else names.index(body)
        slab = to_mm(mask_loops(lab != 0, g, tol_in))
        add(names[b], color(b), [(slab, 0.0, top0), (to_mm(raw[b]), top0, top1)])
        inlaid = [v for v in feats if v != b]
    for v in inlaid:
        add(names[v], color(v), [(to_mm(raw[v]), top0, top1)])
    return parts


def find_profiles(given=None):
    """First Bambu profile folder (one holding machine/, process/, filament/) that exists."""
    cands = [given, os.environ.get("BAMBU_PROFILES"),
             os.path.join(os.environ.get("APPDATA", ""), "BambuStudio", "system", "BBL"),
             os.path.expanduser("~/.config/BambuStudio/system/BBL"),
             os.path.expanduser("~/Library/Application Support/BambuStudio/system/BBL")]
    for c in cands:
        if c and os.path.isdir(os.path.join(c, "machine")) and os.path.isdir(os.path.join(c, "filament")):
            return c
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("labels")
    ap.add_argument("out", help=".3mf path")
    ap.add_argument("--style", choices=["inset", "relief", "flat"], default="inset")
    ap.add_argument("--nozzle-mm", type=float, default=0.4, help="sets the default layer height (half the nozzle)")
    ap.add_argument("--layer-mm", type=float, help="layer height (default: nozzle / 2)")
    ap.add_argument("--inset-layers", type=int, default=10, help="inset depth in layers (default 10)")
    ap.add_argument("--inset-mm", type=float, help="inset depth in mm (overrides --inset-layers)")
    ap.add_argument("--base-mm", type=float, default=1.2, help="solid plate under the inset or relief")
    ap.add_argument("--relief-mm", type=float, default=0.6, help="relief style: art height above the base")
    ap.add_argument("--base-shape", choices=["auto", "rect", "footprint"], default="auto")
    ap.add_argument("--margin-mm", type=float, default=2.0, help="rect plate: border around the art")
    ap.add_argument("--base-color", default="#a0a0a0", help="color of a separate base/plate part")
    ap.add_argument("--body", default="auto", help="inset style, multi-color: which color forms the plate")
    ap.add_argument("--materials", type=int, help="fail unless the plate uses exactly this many materials")
    ap.add_argument("--tol-in", type=float, default=0.0005)
    ap.add_argument("--bambu", choices=["auto", "on", "off"], default="auto",
                    help="write a Bambu Studio project configuration (auto: when Bambu presets are found)")
    ap.add_argument("--printer", default="Bambu Lab X1 Carbon", help="Bambu printer model for the project")
    ap.add_argument("--bambu-profiles", help="Bambu profile folder (resources/profiles/BBL or system/BBL)")
    ap.add_argument("--bambu-version", default="02.08.00.00",
                    help="Bambu Studio version written into the file (keep at or below the installed one)")
    a = ap.parse_args()
    lab, g, names, colors = load_labels(a.labels)
    bc = tuple(int(a.base_color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    layer, depth = layer_heights(a.nozzle_mm, a.layer_mm, a.inset_layers, a.inset_mm)
    snapped = max(1, round(a.base_mm / layer)) * layer          # the base is a default: keep it whole layers
    if abs(snapped - a.base_mm) > 1e-6:
        print(f"note: base {a.base_mm:g} mm rounded to {snapped:g} mm ({snapped / layer:g} layers of {layer:g} mm)")
        a.base_mm = snapped
    if abs(depth / layer - round(depth / layer)) > 1e-6:
        print(f"WARN inset {depth:g} mm is {depth / layer:.2f} layers of {layer:g} mm, not a whole number of layers")
    parts = build_parts(lab, g, names, colors, a.style, a.base_mm, a.relief_mm, a.base_shape, a.margin_mm, bc,
                        a.tol_in, depth, a.body)
    if a.materials and len(parts) != a.materials:
        raise SystemExit(f"FAIL the plate has {len(parts)} materials ({', '.join(p['name'] for p in parts)}), "
                         f"not {a.materials}. Merge colors in the label map, or change --style/--body.")
    title = a.out.replace("\\", "/").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    project, center = None, None
    if a.bambu != "off":
        prof_dir = find_profiles(a.bambu_profiles)
        if prof_dir:
            from bambu_profile import project_settings
            colors = ["#" + bytes(p["color"]).hex().upper() for p in parts]
            project = project_settings(prof_dir, a.printer, a.nozzle_mm, colors, a.bambu_version)
            pts = [tuple(float(v) for v in xy.split("x")) for xy in project.get("printable_area", ["0x0", "256x256"])]
            center = (sum(x for x, _ in pts) / len(pts), sum(y for _, y in pts) / len(pts))
            print(f"  Bambu project: {project['printer_settings_id']}, {project['print_settings_id']}, "
                  f"{len(colors)} x {project['filament_settings_id'][0]} (presets from {prof_dir})")
        elif a.bambu == "on":
            raise SystemExit("FAIL --bambu on: no Bambu profile folder found; pass --bambu-profiles")
        else:
            print("  note: no Bambu presets found, plain 3MF (Bambu Studio will load geometry only)")
    write_3mf(a.out, parts, title, project, center)
    allv = np.vstack([p["V"] for p in parts])
    size = allv.max(0) - allv.min(0)
    print(f"{a.out}: {a.style}, {len(parts)} materials, {sum(len(p['T']) for p in parts)} triangles, "
          f"plate {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} mm ({size[0] / MM:.3f} x {size[1] / MM:.3f} in)")
    if a.style == "inset":
        print(f"  inset {depth:.2f} mm = {depth / layer:.1f} layers of {layer:.2f} mm, base {a.base_mm:.2f} mm "
              f"({a.base_mm / layer:.1f} layers)")
    for k, p in enumerate(parts, start=1):
        c = mesh_check(p["V"], p["T"])
        print(f"  filament {k}: {p['name']} #{bytes(p['color']).hex()}, {c['triangles']} triangles, "
              f"watertight {c['watertight']}, volume {c['volume_mm3']:.1f} mm3, forced ears {p['forced']}")


if __name__ == "__main__":
    main()
```

### `scripts/verify_3mf.py`

```python
"""Check a 3MF before handing it over, and render a top-down preview from the file itself.

Checks (hard failures):
  - package: [Content_Types].xml, _rels/.rels and 3D/3dmodel.model present and parseable,
    a build item, unit millimetre
  - every part watertight and consistently oriented (each edge shared by exactly two triangles
    in opposite directions), positive volume, no degenerate triangles, no folded cap triangles
  - filaments: every part assigned a filament in Metadata/model_settings.config, numbered 1..N
    with one part per filament (--materials N also checks the count)
  - Bambu project (when Metadata/project_settings.config is present): a Bambu printer_model, the
    BambuStudio- Application tag (without it Bambu ignores the settings) and one filament per part
  - with --labels: each color's top area matches the label map (within 2%)
  - with --width-in / --height-in: the art fits the box (the base margin is not counted);
    --plate-width-in / --plate-height-in: the whole plate fits

Example:
  python verify_3mf.py part_n0.4.3mf --labels labels_n0.4.npz --preview part_n0.4_3mf.png
"""
import argparse
import sys
import zipfile
import numpy as np

from mesh3mf import read_3mf, mesh_check


def top_area(V, T):
    """Area of up-facing triangles at the part's top height."""
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    n = np.cross(b - a, c - a)
    up = (n[:, 2] > 0) & np.isclose(a[:, 2], V[:, 2].max()) & np.isclose(b[:, 2], V[:, 2].max())
    return float(0.5 * n[up, 2].sum())


def render(parts, path, px_per_mm=10):
    """Top-down view drawn from the 3MF's own triangles: up-facing faces painted lowest first, with a
    small drop shadow under raised parts, so it shows exactly what the slicer will see from above."""
    from PIL import Image, ImageDraw
    allv = np.vstack([p["V"] for p in parts])
    lo, hi = allv.min(0), allv.max(0)
    pad = 20
    W = int((hi[0] - lo[0]) * px_per_mm) + 2 * pad
    H = int((hi[1] - lo[1]) * px_per_mm) + 2 * pad
    img = Image.new("RGB", (W, H), (45, 45, 45))
    d = ImageDraw.Draw(img)
    tf = lambda q: [((x - lo[0]) * px_per_mm + pad, H - pad - (y - lo[1]) * px_per_mm) for x, y in q]
    zmin = lo[2]
    raised = len({round(float(p["V"][:, 2].max()), 4) for p in parts}) > 1   # flush inlays get no shadow
    for p in sorted(parts, key=lambda q: q["V"][:, 2].max()):
        V, T = p["V"], p["T"]
        ztop = V[:, 2].max()
        tri = V[T]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        up = (n[:, 2] > 0) & np.all(np.isclose(tri[:, :, 2], ztop), axis=1)
        col = p["color"] or "#888888FF"
        rgb = tuple(int(col[i:i + 2], 16) for i in (1, 3, 5))
        if raised and ztop > zmin + (hi[2] - zmin) * 0.75 and p["name"] != "base":
            for t in tri[up]:                       # drop shadow for raised parts
                d.polygon([(x + 2, y + 2) for x, y in tf(t[:, :2])], fill=(20, 20, 20))
        for t in tri[up]:
            d.polygon(tf(t[:, :2]), fill=rgb)
    img.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--labels", help="label map the 3MF was made from")
    ap.add_argument("--width-in", type=float)
    ap.add_argument("--height-in", type=float)
    ap.add_argument("--preview", help="PNG top-down preview rendered from the 3MF")
    ap.add_argument("--materials", type=int, help="expected number of materials (filaments)")
    ap.add_argument("--plate-width-in", type=float, help="the whole plate must fit this width")
    ap.add_argument("--plate-height-in", type=float, help="the whole plate must fit this height")
    a = ap.parse_args()
    ok = True
    with zipfile.ZipFile(a.path) as z:
        model = z.read("3D/3dmodel.model").decode()
    if 'unit="millimeter"' not in model:
        print("FAIL model unit is not millimetre")
        ok = False
    parts, item, title = read_3mf(a.path)
    allv = np.vstack([p["V"] for p in parts])
    size = allv.max(0) - allv.min(0)
    print(f"object '{title}': {len(parts)} parts, {sum(len(p['T']) for p in parts)} triangles, "
          f"{size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} mm, bottom at z = {allv[:, 2].min():.3f}")
    for p in parts:
        c = mesh_check(p["V"], p["T"])
        bad = not c["watertight"] or c["degenerate"]
        ok &= not bad
        print(f"  filament {p['extruder']}: {p['name']} {p['color']}: {c['triangles']} triangles, "
              f"open edges {c['open_edges']}, duplicate edges {c['duplicate_edges']}, degenerate {c['degenerate']}, "
              f"folded {c['folded']}, volume {c['volume_mm3']:.1f} mm3" + ("  FAIL" if bad else ""))
    ext = [p["extruder"] for p in parts]
    if None in ext or sorted(ext) != list(range(1, len(parts) + 1)):
        print(f"FAIL filament assignment {ext}: every part needs its own filament, numbered 1..{len(parts)}")
        ok = False
    print(f"materials: {len(parts)}")
    with zipfile.ZipFile(a.path) as z:
        proj = z.read("Metadata/project_settings.config") if "Metadata/project_settings.config" in z.namelist() else None
    if proj is None:
        print("Bambu project: none (Bambu Studio 2.8.2+ will load geometry only and keep every part on filament 1)")
    else:
        import json
        pj = json.loads(proj)
        cols = pj.get("filament_colour", [])
        app_ok = "BambuStudio-" in model
        print(f"Bambu project: {pj.get('printer_settings_id')}, {pj.get('print_settings_id')}, "
              f"{len(cols)} filaments {cols}" + ("" if app_ok else "  (Application is not BambuStudio-: settings ignored)"))
        if len(cols) != len(parts) or not pj.get("printer_model") or not app_ok:
            print(f"FAIL Bambu project needs printer_model, a BambuStudio- Application and one filament per part "
                  f"({len(cols)} filaments, {len(parts)} parts)")
            ok = False
    if a.materials and a.materials != len(parts):
        print(f"FAIL expected {a.materials} materials")
        ok = False
    tops = {round(float(p["V"][:, 2].max()), 4) for p in parts}
    if len(tops) == 1 and len(parts) > 1:
        # flush top (inset or flat): the parts' top faces must tile the plate's footprint exactly
        def area_at(V, T, z, up):
            a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
            nz = np.cross(b - a, c - a)[:, 2]
            on = np.isclose(a[:, 2], z) & np.isclose(b[:, 2], z) & np.isclose(c[:, 2], z)
            return float(0.5 * np.abs(nz[on & ((nz > 0) if up else (nz < 0))]).sum())
        ztop, zbot = tops.pop(), allv[:, 2].min()
        top_sum = sum(area_at(p["V"], p["T"], ztop, True) for p in parts)
        foot = sum(area_at(p["V"], p["T"], zbot, False) for p in parts)
        dev = abs(top_sum - foot) / max(foot, 1e-9)
        print(f"flush top: parts cover {top_sum:.1f} mm2 of a {foot:.1f} mm2 footprint ({100 * dev:.2f}% off)"
              + ("  FAIL" if dev > 0.005 else ""))
        ok &= dev <= 0.005
    art = [p for p in parts if p["name"] != "base"]
    artv = np.vstack([p["V"] for p in art])
    asz = (artv.max(0) - artv.min(0)) / 25.4
    print(f"art extents: {asz[0]:.3f} x {asz[1]:.3f} in ({asz[0] * 25.4:.1f} x {asz[1] * 25.4:.1f} mm)")
    for name, want, got in (("width", a.plate_width_in, size[0] / 25.4), ("height", a.plate_height_in, size[1] / 25.4)):
        if want and got > want + 0.005:
            print(f"FAIL plate {name} {got:.3f} in exceeds {want} in")
            ok = False
    for name, want, got in (("width", a.width_in, asz[0]), ("height", a.height_in, asz[1])):
        if want and got > want + 0.005:
            print(f"FAIL art {name} {got:.3f} in exceeds {want} in")
            ok = False
    if a.labels:
        from dxf_io import load_labels
        lab, g, names, _ = load_labels(a.labels)
        cell = (g * 25.4) ** 2
        for p in art:
            if p["name"] in names:
                want = (lab == names.index(p["name"])).sum() * cell
                got = top_area(p["V"], p["T"])
                dev = abs(got - want) / max(want, 1e-9)
                flag = "" if dev < 0.02 else "  FAIL"
                ok &= dev < 0.02
                print(f"  {p['name']}: top area {got:.1f} mm2 vs label map {want:.1f} mm2 ({100 * dev:.2f}% off){flag}")
    if a.preview:
        render(parts, a.preview)
        print(f"preview: {a.preview}")
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
```

### `scripts/rebuild_helpers.py`

```python
"""Helpers for rebuilding low-resolution artwork as clean geometry, then saving a label map.

Use this when the source is too small to trace well (lettering under ~20 px tall, simple shapes).
Measure shapes in SOURCE pixel coordinates (x right, y down, as in the image), draw them on a
Canvas, combine masks with & | ~, and save. Each mask is a boolean array on the fine grid.

    from rebuild_helpers import Canvas
    cv = Canvas(src_box=(2.5, 7, 194.5, 188), width_in=3, height_in=3)
    outer = cv.poly([(98.5, 10), (175, 53), (175, 140), (98.5, 185), (22, 140), (22, 53)])
    ring = outer & ~cv.grow(outer, -2)                    # 2 source px wide ring
    txt = cv.text("4864", [(60, 76), (80, 95), (100, 115), (119, 134)], 47, 73, font=cv.font("Inter Display Black"))
    cv.save("labels.npz", [("background", None), ("navy", "#14204a"), ("red", "#d6222c"), ("white", "#ffffff")],
            [navy_mask, red_mask, white_mask])          # later masks win where they overlap

Pixel coordinates follow image convention: pixel (i, j) covers x in [i - 0.5, i + 0.5]. Measured
runs "columns 60 to 76" mean ink from 59.5 to 76.5; text() takes inclusive pixel columns/rows.
"""
import os
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import filters, transform

from dxf_io import save_labels, parse_length


def hex_rgb(h):
    h = h.lstrip("#")
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self, src_box, width_in=None, height_in=None, grid_in=0.0005, width=None, height=None):
        """src_box: (x0, y0, x1, y1) in source px, the area that becomes the part (pixel-edge coords).
        Scaled to fit the box without distortion. Give width/height with a unit ("76mm", "3in") or
        width_in/height_in as numbers in inches."""
        width_in = parse_length(width) or width_in
        height_in = parse_length(height) or height_in
        self.x0, self.y0, self.x1, self.y1 = src_box
        w, h = self.x1 - self.x0, self.y1 - self.y0
        opts = [v for v in (width_in and width_in / w, height_in and height_in / h) if v]
        self.k_in = min(opts)                 # inches per source px
        self.grid_in = grid_in
        self.R = self.k_in / grid_in          # grid cells per source px
        self.W, self.H = int(round(w * self.R)), int(round(h * self.R))

    # coordinates
    def tx(self, x):
        return (x - self.x0) * self.R

    def ty(self, y):
        return (y - self.y0) * self.R

    def blank(self):
        return np.zeros((self.H, self.W), bool)

    # shapes
    def poly(self, pts):
        im = Image.new("1", (self.W, self.H), 0)
        ImageDraw.Draw(im).polygon([(self.tx(x), self.ty(y)) for x, y in pts], fill=1)
        return np.array(im)

    def rect(self, x0, y0, x1, y1):
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def ellipse(self, cx, cy, rx, ry):
        im = Image.new("1", (self.W, self.H), 0)
        ImageDraw.Draw(im).ellipse([self.tx(cx - rx), self.ty(cy - ry), self.tx(cx + rx), self.ty(cy + ry)], fill=1)
        return np.array(im)

    def grow(self, mask, src_px):
        """Offset a shape outward (positive) or inward (negative) by src_px source pixels."""
        r = abs(src_px) * self.R
        if src_px >= 0:
            return ndimage.distance_transform_edt(~mask) <= r
        return ndimage.distance_transform_edt(mask) > r

    def round_corners(self, mask, src_px):
        """Round convex corners (opening) with radius src_px."""
        return self.grow(self.grow(mask, -src_px), src_px)

    # text
    @staticmethod
    def font(name):
        """Path of an installed font: a file path, or a name such as 'Inter Display Black' or
        'DejaVu Sans:bold'. Uses fontconfig where it exists (Linux, macOS). Elsewhere (Windows) it looks
        the family up through matplotlib and, if that is not installed, takes a heavy sans instead."""
        if os.path.isfile(name):
            return name
        if shutil.which("fc-match"):
            path = subprocess.run(["fc-match", "-f", "%{file}", name], capture_output=True, text=True).stdout.strip()
            if os.path.isfile(path):                       # conda's fc-match can run yet know no fonts
                return path
        from matplotlib.font_manager import FontProperties, findfont
        family, _, style = name.partition(":")
        for candidate in (family, "Inter Black", "Arial Black", "Segoe UI Black", "DejaVu Sans"):
            try:
                path = findfont(FontProperties(family=candidate, weight=style or "normal"), fallback_to_default=False)
            except ValueError:
                continue
            if candidate != family:
                print(f"font: '{family}' is not installed, using {candidate}; compare the letters with the source")
            return path
        raise SystemExit(f"no font found for '{name}'; pass a font file path to cv.font()")

    def glyph(self, ch, box, font):
        """One character whose ink box exactly fills box = (x0, x1, y0, y1) in source px (edge coords).
        Counters (holes in O, 4, 8...) come out right through even-odd filling."""
        from matplotlib.textpath import TextPath
        from matplotlib.font_manager import FontProperties
        # to_polygons flattens curves to a fixed tolerance, so a large size keeps letters from going faceted
        tp = TextPath((0, 0), ch, size=4000, prop=FontProperties(fname=font))
        polys = [p for p in tp.to_polygons() if len(p) > 2]
        allp = np.vstack(polys)
        mn, mx = allp.min(0), allp.max(0)
        x0, x1, y0, y1 = box
        m = self.blank()
        for p in polys:
            u = (p[:, 0] - mn[0]) / (mx[0] - mn[0])
            v = (mx[1] - p[:, 1]) / (mx[1] - mn[1])
            im = Image.new("1", (self.W, self.H), 0)
            ImageDraw.Draw(im).polygon([(self.tx(x0 + a * (x1 - x0)), self.ty(y0 + b * (y1 - y0)))
                                        for a, b in zip(u, v)], fill=1)
            m ^= np.array(im)
        return m

    def text(self, chars, columns, row0, row1, font):
        """Place each character at its measured inclusive pixel columns (list of (first, last)),
        all spanning inclusive rows row0..row1. Matches the source's spacing and height exactly."""
        m = self.blank()
        for ch, (c0, c1) in zip(chars, columns):
            m |= self.glyph(ch, (c0 - 0.5, c1 + 0.5, row0 - 0.5, row1 + 0.5), font)
        return m

    # tracing organic bits (a state outline, an icon) from the source
    def trace_from_source(self, img_rgb, crop, threshold=0.5, smooth_src_px=0.4, fill=False, line_src_px=None):
        """Trace a small organic shape from the source image.
        img_rgb: source array (H, W, 3) floats 0-255. crop = (x0, y0, x1, y1) integer source px.
        Selects bright pixels (invert the image first for dark shapes). fill=True fills enclosed
        holes (a thin outline becomes a solid silhouette); line_src_px then rebuilds it as an even
        ring of that width, which prints far better than the raw 1 px line."""
        x0, y0, x1, y1 = crop
        w = img_rgb[y0:y1, x0:x1].mean(-1) / 255.0
        up = filters.gaussian(transform.rescale(w, self.R, order=3), sigma=self.R * smooth_src_px)
        m = up > threshold * (up.max() + np.median(up))
        if fill:
            m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=int(self.R * 0.8)))
            m = filters.gaussian(m.astype(float), sigma=self.R * 0.6) > 0.5
            if line_src_px:
                m = m & ~(ndimage.distance_transform_edt(m) > line_src_px * self.R)
        out = self.blank()
        oy, ox = int(round(self.ty(y0 - 0.5))), int(round(self.tx(x0 - 0.5)))
        hh, ww = min(m.shape[0], self.H - oy), min(m.shape[1], self.W - ox)
        out[oy:oy + hh, ox:ox + ww] = m[:hh, :ww]
        return out

    # output
    def save(self, path, labels, masks):
        """labels: [(name, '#hex' or None), ...] with background first. masks: one per non-background
        label, painted in order (later wins). Areas covered by no mask stay background."""
        lab = np.zeros((self.H, self.W), np.uint8)
        for i, m in enumerate(masks, start=1):
            lab[m] = i
        names = [n for n, _ in labels]
        colors = [hex_rgb(c) if c else (255, 255, 255) for _, c in labels]
        save_labels(path, lab, self.grid_in, names, colors)
        print(f"labels {self.W}x{self.H} = {self.W * self.grid_in:.3f} x {self.H * self.grid_in:.3f} in, "
              f"{len(masks)} colors")
        return lab
```

### `scripts/measure.py`

```python
"""Measure a small logo for the rebuild route.

Classifies each pixel to the nearest palette color, then prints:
  --rows / --cols   color runs along those rows/columns, e.g. "W23-24 N25-27 R28-32" (inclusive px)
  --letters         per-letter column spans and the row span of one text line:
                    "x0:x1:y0:y1:L" scans that box for palette letter L (first letter of its name)
  --zoom PNG        an enlarged classified image to look at
All coordinates are in the cropped image's pixels (pass --crop to work in a sub-area).

Example:
  python measure.py poster.png --crop 232,195,422,385 --palette "W=#ffffff,R=#d6222c,N=#14204a" \
      --rows 20,45,75 --cols 96 --letters "52:146:42:80:R" --zoom classes.png
"""
import argparse
import numpy as np
from PIL import Image


def hex_rgb(h):
    h = h.lstrip("#")
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def runs(v, keys, offset=0):
    out, s = [], 0
    for i in range(1, len(v) + 1):
        if i == len(v) or v[i] != v[s]:
            out.append(f"{keys[v[s]]}{s + offset}-{i - 1 + offset}")
            s = i
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--crop", help="x0,y0,x1,y1")
    ap.add_argument("--palette", required=True, help='"W=#ffffff,R=#d6222c,N=#14204a" (single-letter keys)')
    ap.add_argument("--rows", default="")
    ap.add_argument("--cols", default="")
    ap.add_argument("--letters", action="append", default=[])
    ap.add_argument("--zoom")
    a = ap.parse_args()
    img = np.array(Image.open(a.image).convert("RGB")).astype(float)
    if a.crop:
        x0, y0, x1, y1 = map(int, a.crop.split(","))
        img = img[y0:y1, x0:x1]
    keys, pal = zip(*[(k, hex_rgb(v)) for k, v in (e.split("=") for e in a.palette.split(","))])
    pal = np.array(pal, float)
    cls = np.argmin(((img[..., None, :] - pal) ** 2).sum(-1), -1)
    print(f"image {img.shape[1]}x{img.shape[0]} px")
    for r in filter(None, a.rows.split(",")):
        print(f"row {r}: {runs(cls[int(r)], keys)}")
    for c in filter(None, a.cols.split(",")):
        print(f"col {c}: {runs(cls[:, int(c)], keys)}")
    for spec in a.letters:
        lx0, lx1, ly0, ly1, key = spec.split(":")
        lx0, lx1, ly0, ly1 = map(int, (lx0, lx1, ly0, ly1))
        m = cls[ly0:ly1, lx0:lx1] == keys.index(key)
        cols = list(m.any(0)) + [False]
        segs, s = [], None
        for i, v in enumerate(cols):
            if v and s is None:
                s = i
            if not v and s is not None:
                segs.append((s + lx0, i - 1 + lx0))
                s = None
        ys = np.nonzero(m.any(1))[0]
        print(f"letters {key} in x {lx0}-{lx1}, y {ly0}-{ly1}: columns {segs}; rows {ys.min() + ly0}-{ys.max() + ly0}"
              if len(ys) else f"letters {key}: none found")
    if a.zoom:
        Image.fromarray(pal[cls].astype(np.uint8)).resize((img.shape[1] * 4, img.shape[0] * 4), Image.NEAREST).save(a.zoom)
        print(f"zoom: {a.zoom}")


if __name__ == "__main__":
    main()
```

### `examples/shield_rebuild.py`

```python
"""Worked example of the rebuild route: the FRC 4864 INNOVATION STATION shield from a 452x678 poster,
where the logo is only ~170 px wide. Every number below was measured from the source in source px
(crop origin 232,195 of the poster), by reading color runs along rows and columns.

Run from the scripts folder:  python ../examples/shield_rebuild.py poster.png labels.npz
"""
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, ".")
from rebuild_helpers import Canvas

poster, out = sys.argv[1], sys.argv[2]
src = np.array(Image.open(poster).convert("RGB")).astype(float)[195:385, 232:422]   # same crop as measured

cv = Canvas(src_box=(2.5, 7.7, 194.5, 185.4), width_in=3.0, height_in=3.0)   # artwork edges: bar ends, apexes
font = cv.font("Inter Display Black")

# Elongated hexagon: centre column 98.5, edges at 29.2 deg, top half centred on y 94.8, bottom on 98.3.
CX, CYT, CYB, TH = 98.5, 94.8, 98.3, np.radians(29.2)


def hexagon(a):   # a = distance from the centre to the vertical sides
    t, s = 1 / np.cos(TH), np.tan(TH)
    return cv.poly([(CX, CYT - a * t), (CX + a, CYT - a * t + a * s), (CX + a, CYB + a * t - a * s),
                    (CX, CYB + a * t), (CX - a, CYB + a * t - a * s), (CX - a, CYT - a * t + a * s)])


H76, H74, H71, H66, H63 = (hexagon(a) for a in (76, 74, 71, 66, 63))   # ring edges measured on row 75
X0, X1 = 2.5, 194.5
band = cv.rect(X0 - 5, 78.5, X1 + 5, 121.5)        # navy zone behind the banner
cut = cv.rect(X0 - 5, 82.5, X1 + 5, 117.5)
body = cv.rect(5.5, 83.5, 191.5, 116.5)             # white banner
bars = (cv.rect(X0, 80.5, CX - 74, 82.5) | cv.rect(X0, 117.5, CX - 74, 119.5) |
        cv.rect(CX + 74, 80.5, X1, 82.5) | cv.rect(CX + 74, 117.5, X1, 119.5))
footprint = H76 | cv.rect(X0, 80.5, X1, 119.5)

# Text: per-letter inclusive columns and rows, measured from column projections.
t4864 = cv.text("4864", [(60, 76), (80, 95), (100, 115), (119, 134)], 47, 73, font)
tinnov = cv.text("INNOVATION", [(15, 20), (25, 41), (46, 62), (66, 81), (83, 100), (99, 116), (118, 131),
                                (135, 140), (143, 159), (163, 178)], 92, 110, font)
tstat = cv.text("STATION", [(68, 74), (77, 83), (85, 93), (95, 102), (105, 107), (110, 117), (121, 128)],
                127, 138, font)

# South Carolina: traced from the 1 px source outline, filled, rebuilt as an even 1.2 px ring.
sc = cv.trace_from_source(src, (72, 145, 128, 175), fill=True, line_src_px=1.2)

interior = cv.round_corners(H63 & ~cv.rect(X0 - 5, 142.5, X1 + 5, 200) & ~band, 3)
white = ((H76 & ~H74) & ~cut) | bars | (body & ~tinnov) | (interior & ~t4864 & ~tstat) | (sc & H63)
red = ((H71 & ~H66) & ~band) | (t4864 & H63)
white &= ~red
navy = footprint & ~white & ~red

cv.save(out, [("background", None), ("navy", "#14204a"), ("red", "#d6222c"), ("white", "#ffffff")],
        [navy, red, white])
```
