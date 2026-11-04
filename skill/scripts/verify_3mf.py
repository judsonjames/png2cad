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
