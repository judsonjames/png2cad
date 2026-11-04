"""Turn a raster image into a high-resolution label map sized in inches.

Two modes:
  mask    one foreground color on a background (line art, silhouettes)
  colors  several flat colors (logos). Give --palette "#ffffff,#d6222c,#14204a" or --colors N.

Output: labels.npz for pipeline.py (nozzle fitting, export, checks). Label 0 is the background,
which is not part of the part. Line and gap widths are NOT adjusted here; pipeline.py fits them to
the nozzle. The map is cropped to the artwork and scaled to fit --width-in x --height-in
without distortion (give either or both).

Sizes take a unit: 5in, 127mm, 12.7cm (a bare number is inches). --width-in/--height-in still work.

Examples:
  python make_labels.py truck.png labels.npz --mode mask --width 5in
  python make_labels.py logo.png labels.npz --mode colors --palette "#fff,#d6222c,#14204a" --width 76mm --height 76mm
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.cluster.vq import kmeans2
from skimage import filters, transform

from dxf_io import save_labels, parse_length, fmt_size


def hex_to_rgb(h):
    h = h.strip().lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def border_pixels(img):
    return np.vstack([img[:2].reshape(-1, 3), img[-2:].reshape(-1, 3),
                      img[:, :2].reshape(-1, 3), img[:, -2:].reshape(-1, 3)])


def fit_scale(w_src, h_src, width_in, height_in):
    """Inches per source pixel so the artwork fits inside the box without distortion."""
    options = []
    if width_in:
        options.append(width_in / w_src)
    if height_in:
        options.append(height_in / h_src)
    if not options:
        raise SystemExit("give --width and/or --height (for example 5in or 127mm)")
    return min(options)


def content_box(fg, margin=1):
    ys, xs = np.nonzero(fg)
    if len(xs) == 0:
        raise SystemExit("no artwork found; check --fg / --palette")
    return (max(xs.min() - margin, 0), max(ys.min() - margin, 0),
            min(xs.max() + margin + 1, fg.shape[1]), min(ys.max() + margin + 1, fg.shape[0]))


def speck_cells(a):
    """Areas smaller than a --speck-mm square are noise (anti-aliasing, JPEG dust)."""
    return (a.speck_mm / 25.4 / a.grid_in) ** 2


def remove_specks(labels, min_area_px):
    """Merge connected regions smaller than min_area_px into their surroundings."""
    out = labels.copy()
    bad = np.zeros(labels.shape, bool)
    for v in np.unique(labels):
        comp, n = ndimage.label(labels == v)
        if n == 0:
            continue
        sizes = ndimage.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
        small = np.nonzero(sizes < min_area_px)[0] + 1
        if len(small):
            bad |= np.isin(comp, small)
    if bad.any():
        _, (iy, ix) = ndimage.distance_transform_edt(bad, return_indices=True)
        out[bad] = labels[iy[bad], ix[bad]]
    return out


def mask_mode(img, a):
    bg = np.median(border_pixels(img), axis=0) if a.bg == "auto" else hex_to_rgb(a.bg)
    if a.fg == "auto":
        d = np.linalg.norm(img - bg, axis=-1)
        fg = np.median(img[d > 0.5 * d.max()], axis=0)
    else:
        fg = hex_to_rgb(a.fg)
    axis = fg - bg
    f = np.clip(((img - bg) @ axis) / (axis @ axis), 0, 1)   # 0 = background, 1 = foreground, AA in between
    x0, y0, x1, y1 = content_box(f > 0.5)
    k_src = fit_scale(x1 - x0, y1 - y0, a.width_in, a.height_in)
    up = k_src / a.grid_in
    big = transform.rescale(f[y0:y1, x0:x1], up, order=3, anti_aliasing=False)
    big = filters.gaussian(big, sigma=0.35 * up)
    b = big > 0.5
    lab = (filters.gaussian(b.astype(float), sigma=1.5) > 0.5).astype(np.uint8)
    lab = remove_specks(lab, speck_cells(a))            # after smoothing, which can pinch off pinholes
    names = ["background", "foreground"]
    colors = [tuple(bg.astype(int)), tuple(fg.astype(int))]
    return lab, names, colors


def colors_mode(img, a):
    if a.palette:
        pal = np.array([hex_to_rgb(h) for h in a.palette.split(",")])
    else:
        px = img.reshape(-1, 3)[:: max(1, img.size // 3 // 200000)]
        pal, _ = kmeans2(px, a.colors, minit="++", seed=1)
    # background = the palette color most common on the border
    border = border_pixels(img)
    bidx = np.argmin(((border[:, None, :] - pal[None]) ** 2).sum(-1), axis=1)
    bgi = np.bincount(bidx, minlength=len(pal)).argmax()
    if a.bg != "auto":
        bgi = int(np.argmin(((pal - hex_to_rgb(a.bg)) ** 2).sum(-1)))
    order = [bgi] + [i for i in range(len(pal)) if i != bgi]
    pal = pal[order]
    d2 = ((img[..., None, :] - pal) ** 2).sum(-1)
    pd = np.sqrt(((pal[:, None] - pal[None]) ** 2).sum(-1))
    sigma = 0.35 * pd[pd > 0].min()
    w = np.exp(-(d2 - d2.min(-1, keepdims=True)) / (2 * sigma ** 2))
    w /= w.sum(-1, keepdims=True)
    x0, y0, x1, y1 = content_box(w[..., 0] < 0.5)
    k_src = fit_scale(x1 - x0, y1 - y0, a.width_in, a.height_in)
    up = k_src / a.grid_in
    best = best_i = None
    for i in range(len(pal)):   # upscale each class weight and keep the argmax, one class at a time
        big = filters.gaussian(transform.rescale(w[y0:y1, x0:x1, i], up, order=3), sigma=0.35 * up)
        if best is None:
            best, best_i = big.astype(np.float32), np.zeros(big.shape, np.uint8)
        else:
            m = big > best
            best[m], best_i[m] = big[m], i
    lab = remove_specks(best_i, speck_cells(a))
    names = ["background"] + [f"color{i}" for i in range(1, len(pal))]
    return lab, names, [tuple(c.astype(int)) for c in pal]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("image")
    p.add_argument("out", help="labels .npz")
    p.add_argument("--mode", choices=["mask", "colors"], required=True)
    p.add_argument("--width", help="target width with unit: 5in, 127mm, 12.7cm")
    p.add_argument("--height", help="target height with unit")
    p.add_argument("--width-in", type=float, help=argparse.SUPPRESS)
    p.add_argument("--height-in", type=float, help=argparse.SUPPRESS)
    p.add_argument("--grid-in", type=float, default=0.0005, help="label grid cell size in inches")
    p.add_argument("--speck-mm", type=float, default=0.15, help="merge specks smaller than this square")
    p.add_argument("--bg", default="auto", help="background color (#hex) or auto (from the image border)")
    p.add_argument("--fg", default="auto", help="mask mode: foreground color (#hex) or auto")
    p.add_argument("--palette", help="colors mode: comma-separated #hex colors, background included")
    p.add_argument("--colors", type=int, default=3, help="colors mode without --palette: k-means count")
    a = p.parse_args()
    a.width_in = parse_length(a.width) or a.width_in
    a.height_in = parse_length(a.height) or a.height_in
    img = np.array(Image.open(a.image).convert("RGB")).astype(float)
    lab, names, colors = (mask_mode if a.mode == "mask" else colors_mode)(img, a)
    save_labels(a.out, lab, a.grid_in, names, colors)
    h, w = lab.shape
    print(f"labels {w}x{h} cells = {fmt_size(w * a.grid_in, h * a.grid_in)}; "
          f"labels: {', '.join(f'{i}={n} #{bytes(map(int, c)).hex()}' for i, (n, c) in enumerate(zip(names, colors)))}")


if __name__ == "__main__":
    main()
