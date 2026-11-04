"""Worked example of the rebuild route: the FRC 4864 INNOVATION STATION shield from a 452x678 poster,
where the logo is only ~170 px wide. Every number below was measured from the source in source px
(crop origin 232,195 of the poster), by reading color runs along rows and columns.

Run from the scripts folder:  python ../examples/shield_rebuild.py poster.png labels.npz
"""
import sys
import numpy as np
from PIL import Image

sys.path.insert(0, ".")
from rebuild_helpers import Canvas

poster, out = sys.argv[1], sys.argv[2]
src = np.array(Image.open(poster).convert("RGB")).astype(float)[195:385, 232:422]   # same crop as measured

cv = Canvas(src_box=(2.5, 7.7, 194.5, 185.4), width_in=3.0, height_in=3.0)   # artwork edges: bar ends, apexes
font = cv.font("Inter Display Black")

# Elongated hexagon: centre column 98.5, edges at 29.2 deg, top half centred on y 94.8, bottom on 98.3.
CX, CYT, CYB, TH = 98.5, 94.8, 98.3, np.radians(29.2)


def hexagon(a):   # a = distance from the centre to the vertical sides
    t, s = 1 / np.cos(TH), np.tan(TH)
    return cv.poly([(CX, CYT - a * t), (CX + a, CYT - a * t + a * s), (CX + a, CYB + a * t - a * s),
                    (CX, CYB + a * t), (CX - a, CYB + a * t - a * s), (CX - a, CYT - a * t + a * s)])


H76, H74, H71, H66, H63 = (hexagon(a) for a in (76, 74, 71, 66, 63))   # ring edges measured on row 75
X0, X1 = 2.5, 194.5
band = cv.rect(X0 - 5, 78.5, X1 + 5, 121.5)        # navy zone behind the banner
cut = cv.rect(X0 - 5, 82.5, X1 + 5, 117.5)
body = cv.rect(5.5, 83.5, 191.5, 116.5)             # white banner
bars = (cv.rect(X0, 80.5, CX - 74, 82.5) | cv.rect(X0, 117.5, CX - 74, 119.5) |
        cv.rect(CX + 74, 80.5, X1, 82.5) | cv.rect(CX + 74, 117.5, X1, 119.5))
footprint = H76 | cv.rect(X0, 80.5, X1, 119.5)

# Text: per-letter inclusive columns and rows, measured from column projections.
t4864 = cv.text("4864", [(60, 76), (80, 95), (100, 115), (119, 134)], 47, 73, font)
tinnov = cv.text("INNOVATION", [(15, 20), (25, 41), (46, 62), (66, 81), (83, 100), (99, 116), (118, 131),
                                (135, 140), (143, 159), (163, 178)], 92, 110, font)
tstat = cv.text("STATION", [(68, 74), (77, 83), (85, 93), (95, 102), (105, 107), (110, 117), (121, 128)],
                127, 138, font)

# South Carolina: traced from the 1 px source outline, filled, rebuilt as an even 1.2 px ring.
sc = cv.trace_from_source(src, (72, 145, 128, 175), fill=True, line_src_px=1.2)

interior = cv.round_corners(H63 & ~cv.rect(X0 - 5, 142.5, X1 + 5, 200) & ~band, 3)
white = ((H76 & ~H74) & ~cut) | bars | (body & ~tinnov) | (interior & ~t4864 & ~tstat) | (sc & H63)
red = ((H71 & ~H66) & ~band) | (t4864 & H63)
white &= ~red
navy = footprint & ~white & ~red

cv.save(out, [("background", None), ("navy", "#14204a"), ("red", "#d6222c"), ("white", "#ffffff")],
        [navy, red, white])
