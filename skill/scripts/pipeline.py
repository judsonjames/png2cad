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
