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
