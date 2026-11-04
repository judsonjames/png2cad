"""Helpers for rebuilding low-resolution artwork as clean geometry, then saving a label map.

Use this when the source is too small to trace well (lettering under ~20 px tall, simple shapes).
Measure shapes in SOURCE pixel coordinates (x right, y down, as in the image), draw them on a
Canvas, combine masks with & | ~, and save. Each mask is a boolean array on the fine grid.

    from rebuild_helpers import Canvas
    cv = Canvas(src_box=(2.5, 7, 194.5, 188), width_in=3, height_in=3)
    outer = cv.poly([(98.5, 10), (175, 53), (175, 140), (98.5, 185), (22, 140), (22, 53)])
    ring = outer & ~cv.grow(outer, -2)                    # 2 source px wide ring
    txt = cv.text("4864", [(60, 76), (80, 95), (100, 115), (119, 134)], 47, 73, font=cv.font("Inter Display Black"))
    cv.save("labels.npz", [("background", None), ("navy", "#14204a"), ("red", "#d6222c"), ("white", "#ffffff")],
            [navy_mask, red_mask, white_mask])          # later masks win where they overlap

Pixel coordinates follow image convention: pixel (i, j) covers x in [i - 0.5, i + 0.5]. Measured
runs "columns 60 to 76" mean ink from 59.5 to 76.5; text() takes inclusive pixel columns/rows.
"""
import os
import shutil
import subprocess
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import filters, transform

from dxf_io import save_labels, parse_length


def hex_rgb(h):
    h = h.lstrip("#")
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self, src_box, width_in=None, height_in=None, grid_in=0.0005, width=None, height=None):
        """src_box: (x0, y0, x1, y1) in source px, the area that becomes the part (pixel-edge coords).
        Scaled to fit the box without distortion. Give width/height with a unit ("76mm", "3in") or
        width_in/height_in as numbers in inches."""
        width_in = parse_length(width) or width_in
        height_in = parse_length(height) or height_in
        self.x0, self.y0, self.x1, self.y1 = src_box
        w, h = self.x1 - self.x0, self.y1 - self.y0
        opts = [v for v in (width_in and width_in / w, height_in and height_in / h) if v]
        self.k_in = min(opts)                 # inches per source px
        self.grid_in = grid_in
        self.R = self.k_in / grid_in          # grid cells per source px
        self.W, self.H = int(round(w * self.R)), int(round(h * self.R))

    # coordinates
    def tx(self, x):
        return (x - self.x0) * self.R

    def ty(self, y):
        return (y - self.y0) * self.R

    def blank(self):
        return np.zeros((self.H, self.W), bool)

    # shapes
    def poly(self, pts):
        im = Image.new("1", (self.W, self.H), 0)
        ImageDraw.Draw(im).polygon([(self.tx(x), self.ty(y)) for x, y in pts], fill=1)
        return np.array(im)

    def rect(self, x0, y0, x1, y1):
        return self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def ellipse(self, cx, cy, rx, ry):
        im = Image.new("1", (self.W, self.H), 0)
        ImageDraw.Draw(im).ellipse([self.tx(cx - rx), self.ty(cy - ry), self.tx(cx + rx), self.ty(cy + ry)], fill=1)
        return np.array(im)

    def grow(self, mask, src_px):
        """Offset a shape outward (positive) or inward (negative) by src_px source pixels."""
        r = abs(src_px) * self.R
        if src_px >= 0:
            return ndimage.distance_transform_edt(~mask) <= r
        return ndimage.distance_transform_edt(mask) > r

    def round_corners(self, mask, src_px):
        """Round convex corners (opening) with radius src_px."""
        return self.grow(self.grow(mask, -src_px), src_px)

    # text
    @staticmethod
    def font(name):
        """Path of an installed font: a file path, or a name such as 'Inter Display Black' or
        'DejaVu Sans:bold'. Uses fontconfig where it exists (Linux, macOS). Elsewhere (Windows) it looks
        the family up through matplotlib and, if that is not installed, takes a heavy sans instead."""
        if os.path.isfile(name):
            return name
        if shutil.which("fc-match"):
            path = subprocess.run(["fc-match", "-f", "%{file}", name], capture_output=True, text=True).stdout.strip()
            if os.path.isfile(path):                       # conda's fc-match can run yet know no fonts
                return path
        from matplotlib.font_manager import FontProperties, findfont
        family, _, style = name.partition(":")
        for candidate in (family, "Inter Black", "Arial Black", "Segoe UI Black", "DejaVu Sans"):
            try:
                path = findfont(FontProperties(family=candidate, weight=style or "normal"), fallback_to_default=False)
            except ValueError:
                continue
            if candidate != family:
                print(f"font: '{family}' is not installed, using {candidate}; compare the letters with the source")
            return path
        raise SystemExit(f"no font found for '{name}'; pass a font file path to cv.font()")

    def glyph(self, ch, box, font):
        """One character whose ink box exactly fills box = (x0, x1, y0, y1) in source px (edge coords).
        Counters (holes in O, 4, 8...) come out right through even-odd filling."""
        from matplotlib.textpath import TextPath
        from matplotlib.font_manager import FontProperties
        # to_polygons flattens curves to a fixed tolerance, so a large size keeps letters from going faceted
        tp = TextPath((0, 0), ch, size=4000, prop=FontProperties(fname=font))
        polys = [p for p in tp.to_polygons() if len(p) > 2]
        allp = np.vstack(polys)
        mn, mx = allp.min(0), allp.max(0)
        x0, x1, y0, y1 = box
        m = self.blank()
        for p in polys:
            u = (p[:, 0] - mn[0]) / (mx[0] - mn[0])
            v = (mx[1] - p[:, 1]) / (mx[1] - mn[1])
            im = Image.new("1", (self.W, self.H), 0)
            ImageDraw.Draw(im).polygon([(self.tx(x0 + a * (x1 - x0)), self.ty(y0 + b * (y1 - y0)))
                                        for a, b in zip(u, v)], fill=1)
            m ^= np.array(im)
        return m

    def text(self, chars, columns, row0, row1, font):
        """Place each character at its measured inclusive pixel columns (list of (first, last)),
        all spanning inclusive rows row0..row1. Matches the source's spacing and height exactly."""
        m = self.blank()
        for ch, (c0, c1) in zip(chars, columns):
            m |= self.glyph(ch, (c0 - 0.5, c1 + 0.5, row0 - 0.5, row1 + 0.5), font)
        return m

    # tracing organic bits (a state outline, an icon) from the source
    def trace_from_source(self, img_rgb, crop, threshold=0.5, smooth_src_px=0.4, fill=False, line_src_px=None):
        """Trace a small organic shape from the source image.
        img_rgb: source array (H, W, 3) floats 0-255. crop = (x0, y0, x1, y1) integer source px.
        Selects bright pixels (invert the image first for dark shapes). fill=True fills enclosed
        holes (a thin outline becomes a solid silhouette); line_src_px then rebuilds it as an even
        ring of that width, which prints far better than the raw 1 px line."""
        x0, y0, x1, y1 = crop
        w = img_rgb[y0:y1, x0:x1].mean(-1) / 255.0
        up = filters.gaussian(transform.rescale(w, self.R, order=3), sigma=self.R * smooth_src_px)
        m = up > threshold * (up.max() + np.median(up))
        if fill:
            m = ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=int(self.R * 0.8)))
            m = filters.gaussian(m.astype(float), sigma=self.R * 0.6) > 0.5
            if line_src_px:
                m = m & ~(ndimage.distance_transform_edt(m) > line_src_px * self.R)
        out = self.blank()
        oy, ox = int(round(self.ty(y0 - 0.5))), int(round(self.tx(x0 - 0.5)))
        hh, ww = min(m.shape[0], self.H - oy), min(m.shape[1], self.W - ox)
        out[oy:oy + hh, ox:ox + ww] = m[:hh, :ww]
        return out

    # output
    def save(self, path, labels, masks):
        """labels: [(name, '#hex' or None), ...] with background first. masks: one per non-background
        label, painted in order (later wins). Areas covered by no mask stay background."""
        lab = np.zeros((self.H, self.W), np.uint8)
        for i, m in enumerate(masks, start=1):
            lab[m] = i
        names = [n for n, _ in labels]
        colors = [hex_rgb(c) if c else (255, 255, 255) for _, c in labels]
        save_labels(path, lab, self.grid_in, names, colors)
        print(f"labels {self.W}x{self.H} = {self.W * self.grid_in:.3f} x {self.H * self.grid_in:.3f} in, "
              f"{len(masks)} colors")
        return lab
