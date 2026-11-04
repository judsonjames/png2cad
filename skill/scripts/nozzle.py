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
