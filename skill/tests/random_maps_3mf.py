"""Mesh stress test: random multi-color label maps through every 3MF style. Run from scripts/:
    python ../tests/random_maps_3mf.py
Must print 0 failures and 0 forced ears."""
import sys, numpy as np
sys.path.insert(0, '.')
from scipy import ndimage
from labels_to_3mf import build_parts
from mesh3mf import mesh_check, write_3mf, read_3mf
fails = n = forced = 0
for seed in (11, 12, 13, 14):
    rng = np.random.default_rng(seed)
    for t in range(36):
        H, W = rng.integers(300, 650, 2)
        f = np.stack([ndimage.gaussian_filter(rng.random((H, W)), rng.uniform(5, 18)) for _ in range(3)])
        lab = (np.argmax(f, 0) + 1).astype(np.uint8)
        q = ndimage.gaussian_filter(rng.random((H, W)), 12); lab[q < np.quantile(q, 0.3)] = 0
        if t % 4 == 3: lab[lab > 1] = 0
        lab[:5] = 0; lab[-5:] = 0; lab[:, :5] = 0; lab[:, -5:] = 0
        names = ['background', 'a', 'b', 'c']; cols = [(0, 0, 0), (255, 0, 0), (0, 255, 0), (0, 0, 255)]
        style = ['inset', 'relief', 'flat', 'inset'][t % 4]
        parts = build_parts(lab, 0.002, names, cols, style=style, inset_mm=2.0)
        forced += sum(p['forced'] for p in parts)
        write_3mf('_stress.3mf', parts, 'stress'); back, _, _ = read_3mf('_stress.3mf')
        for p in back:
            n += 1; c = mesh_check(p['V'], p['T'])
            if not c['watertight'] or c['degenerate']:
                fails += 1; print('seed', seed, 'test', t, style, p['name'], c)
print(f'144 random maps, {n} parts: {fails} failures, forced ears {forced}')
