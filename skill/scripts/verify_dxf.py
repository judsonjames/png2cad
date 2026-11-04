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
