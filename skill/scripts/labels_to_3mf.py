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
