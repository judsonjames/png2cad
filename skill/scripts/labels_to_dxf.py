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
