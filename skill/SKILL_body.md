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
