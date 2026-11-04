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
