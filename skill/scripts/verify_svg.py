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
        m = re.fullmatch(r"([\d.]+)(mm|in)", root.get(key, ""))
        if not m:
            problems.append(f"{key} is not in mm or in: {root.get(key)}")
        sizes.append(float(m.group(1)) * (25.4 if m.group(2) == "in" else 1.0) if m else 0.0)
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
    past = 0.0
    for _, _, paths in groups:
        for path in paths:
            for segs, _ in path:
                q = flatten_subpath(segs)
                if len(q):
                    past = max(past, float(-q.min()), float(q[:, 0].max() - sizes[0]), float(q[:, 1].max() - sizes[1]))
    if past > 0.005:
        problems.append(f"art runs {past:.3f} mm past the edge of the page")
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
