/** Hostile input: random multi-color maps through every plate style and the SVG, including corner-to-corner touches. */
import { boundaryChains, cubicAreas, fitChains, type LabelMap } from "@png2cad/core";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import { buildParts, verifySvg, verifyThreeMf, writeSvg, writeThreeMf, type PlateStyle } from "../src/index.ts";

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function blur(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -3; k <= 3; k++) s += a[y * w + Math.min(Math.max(x + k, 0), w - 1)];
        b[y * w + x] = s / 7;
      }
    }
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -3; k <= 3; k++) s += b[Math.min(Math.max(y + k, 0), h - 1) * w + x];
        c[y * w + x] = s / 7;
      }
    }
    a = c;
  }
  return a;
}

function randomMap(seed: number, t: number): LabelMap {
  const r = rng(seed * 1000 + t);
  const w = 260 + Math.floor(r() * 200);
  const h = 260 + Math.floor(r() * 200);
  const noise = () =>
    blur(
      Float32Array.from({ length: w * h }, () => r()),
      w,
      h,
      2 + Math.floor(r() * 4),
    );
  const f = [noise(), noise(), noise()];
  const q = noise();
  const sorted = Float32Array.from(q).sort();
  const cut = sorted[Math.floor(0.3 * sorted.length)];
  const data = new Uint8Array(w * h);
  for (let i = 0; i < data.length; i++) {
    data[i] = q[i] < cut ? 0 : f[0][i] >= f[1][i] && f[0][i] >= f[2][i] ? 1 : f[1][i] >= f[2][i] ? 2 : 3;
    if (t % 4 === 3 && data[i] > 1) data[i] = 0;
  }
  if (t % 4 === 2) {
    for (let k = 0; k < 20; k++) {
      const y = 10 + Math.floor(r() * (h - 22));
      const x = 10 + Math.floor(r() * (w - 22));
      data[y * w + x] = 1;
      data[y * w + x + 1] = 2;
      data[(y + 1) * w + x] = 2;
      data[(y + 1) * w + x + 1] = 1;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (x < 5 || y < 5 || x >= w - 5 || y >= h - 5) data[y * w + x] = 0;
  }
  return {
    data,
    width: w,
    height: h,
    cellMm: 0.0127,
    names: ["background", "a", "b", "c"],
    colors: [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ],
  };
}

describe("random maps", () => {
  const styles: PlateStyle[] = ["inset", "relief", "flat", "inset"];

  it("always give closed, unfolded parts and clean SVG", () => {
    const bad: string[] = [];
    let parts = 0;
    for (const seed of [31, 32]) {
      for (let t = 0; t < 16; t++) {
        const map = randomMap(seed, t);
        const chains = boundaryChains(map);
        const built = buildParts(wasm, map, chains, { style: styles[t % 4], baseMm: 1.2, insetMm: 2 });
        const { findings, parts: read } = verifyThreeMf(writeThreeMf(built));
        parts += read.length;
        for (const f of findings) if (f.severity === "fault") bad.push(`3MF ${seed}/${t}: ${f.message}`);
        for (const p of read) if (p.folded) bad.push(`3MF ${seed}/${t}: ${p.name} folded ${p.folded}`);
        const areas = cubicAreas(chains, fitChains(chains, map.cellMm));
        const colors = [...areas.keys()]
          .sort((a, b) => a - b)
          .map((v) => ({ name: map.names[v], color: map.colors[v], areas: areas.get(v) ?? [] }));
        for (const f of verifySvg(writeSvg(colors).text)) {
          if (f.severity === "fault") bad.push(`SVG ${seed}/${t}: ${f.message}`);
        }
      }
    }
    expect(parts).toBeGreaterThan(60);
    expect(bad).toEqual([]);
  }, 280_000);
});
