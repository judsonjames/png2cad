"""Measure a small logo for the rebuild route.

Classifies each pixel to the nearest palette color, then prints:
  --rows / --cols   color runs along those rows/columns, e.g. "W23-24 N25-27 R28-32" (inclusive px)
  --letters         per-letter column spans and the row span of one text line:
                    "x0:x1:y0:y1:L" scans that box for palette letter L (first letter of its name)
  --zoom PNG        an enlarged classified image to look at
All coordinates are in the cropped image's pixels (pass --crop to work in a sub-area).

Example:
  python measure.py poster.png --crop 232,195,422,385 --palette "W=#ffffff,R=#d6222c,N=#14204a" \
      --rows 20,45,75 --cols 96 --letters "52:146:42:80:R" --zoom classes.png
"""
import argparse
import numpy as np
from PIL import Image


def hex_rgb(h):
    h = h.lstrip("#")
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def runs(v, keys, offset=0):
    out, s = [], 0
    for i in range(1, len(v) + 1):
        if i == len(v) or v[i] != v[s]:
            out.append(f"{keys[v[s]]}{s + offset}-{i - 1 + offset}")
            s = i
    return " ".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image")
    ap.add_argument("--crop", help="x0,y0,x1,y1")
    ap.add_argument("--palette", required=True, help='"W=#ffffff,R=#d6222c,N=#14204a" (single-letter keys)')
    ap.add_argument("--rows", default="")
    ap.add_argument("--cols", default="")
    ap.add_argument("--letters", action="append", default=[])
    ap.add_argument("--zoom")
    a = ap.parse_args()
    img = np.array(Image.open(a.image).convert("RGB")).astype(float)
    if a.crop:
        x0, y0, x1, y1 = map(int, a.crop.split(","))
        img = img[y0:y1, x0:x1]
    keys, pal = zip(*[(k, hex_rgb(v)) for k, v in (e.split("=") for e in a.palette.split(","))])
    pal = np.array(pal, float)
    cls = np.argmin(((img[..., None, :] - pal) ** 2).sum(-1), -1)
    print(f"image {img.shape[1]}x{img.shape[0]} px")
    for r in filter(None, a.rows.split(",")):
        print(f"row {r}: {runs(cls[int(r)], keys)}")
    for c in filter(None, a.cols.split(",")):
        print(f"col {c}: {runs(cls[:, int(c)], keys)}")
    for spec in a.letters:
        lx0, lx1, ly0, ly1, key = spec.split(":")
        lx0, lx1, ly0, ly1 = map(int, (lx0, lx1, ly0, ly1))
        m = cls[ly0:ly1, lx0:lx1] == keys.index(key)
        cols = list(m.any(0)) + [False]
        segs, s = [], None
        for i, v in enumerate(cols):
            if v and s is None:
                s = i
            if not v and s is not None:
                segs.append((s + lx0, i - 1 + lx0))
                s = None
        ys = np.nonzero(m.any(1))[0]
        print(f"letters {key} in x {lx0}-{lx1}, y {ly0}-{ly1}: columns {segs}; rows {ys.min() + ly0}-{ys.max() + ly0}"
              if len(ys) else f"letters {key}: none found")
    if a.zoom:
        Image.fromarray(pal[cls].astype(np.uint8)).resize((img.shape[1] * 4, img.shape[0] * 4), Image.NEAREST).save(a.zoom)
        print(f"zoom: {a.zoom}")


if __name__ == "__main__":
    main()
