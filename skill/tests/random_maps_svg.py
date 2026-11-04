"""SVG stress test: random multi-color label maps, including pinch points where one color touches
itself at a corner. Run from scripts/:
    python ../tests/random_maps_svg.py
Must print 0 failures."""
import sys
import numpy as np
from scipy import ndimage

sys.path.insert(0, ".")
from labels_to_svg import build_svg
from verify_svg import check_svg

names = ["background", "a", "b", "c"]
cols = [(0, 0, 0), (255, 0, 0), (0, 255, 0), (0, 0, 255)]
fails = n = 0
for seed in (21, 22, 23, 24):
    rng = np.random.default_rng(seed)
    for t in range(24):
        H, W = rng.integers(300, 650, 2)
        f = np.stack([ndimage.gaussian_filter(rng.random((H, W)), rng.uniform(5, 18)) for _ in range(3)])
        lab = (np.argmax(f, 0) + 1).astype(np.uint8)
        q = ndimage.gaussian_filter(rng.random((H, W)), 12)
        lab[q < np.quantile(q, 0.3)] = 0
        if t % 4 == 3:
            lab[lab > 1] = 0
        if t % 4 == 2:                                     # force corner-to-corner touches
            for _ in range(20):
                r, c = rng.integers(10, H - 12), rng.integers(10, W - 12)
                lab[r:r + 2, c:c + 2] = [[1, 2], [2, 1]]
        lab[:5] = 0
        lab[-5:] = 0
        lab[:, :5] = 0
        lab[:, -5:] = 0
        text, _ = build_svg(lab, 0.0005, names, cols, tol_mm=0.02)      # the grid make_labels.py uses
        ok, lines = check_svg(text, lab, 0.0005, names, tol_mm=0.1, px_per_mm=80.0)
        n += 1
        if not ok:
            fails += 1
            print("seed", seed, "test", t, [x for x in lines if x.startswith("FAIL")])
print(f"{n} random maps: {fails} failures")
