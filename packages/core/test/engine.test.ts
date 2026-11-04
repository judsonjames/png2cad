import { describe, expect, it } from "vitest";
import {
  boundaryChains,
  chainsToCurves,
  cubicAreas,
  distanceSquared,
  findCrossings,
  fitChains,
  fitToNozzle,
  opened,
  parseLength,
  regionsOf,
  simplify,
  suggestTrace,
  thinSpots,
  traceImage,
  type LabelMap,
  type Rgb,
} from "../src/index.ts";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function image(w: number, h: number, paint: (x: number, y: number) => Rgb) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  }
  return { data, width: w, height: h };
}

function labelMap(w: number, h: number, paint: (x: number, y: number) => number, cellMm = 0.0254): LabelMap {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = paint(x, y);
  return {
    data,
    width: w,
    height: h,
    cellMm,
    names: ["background", "a", "b", "c"],
    colors: [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ],
  };
}

describe("distance transform", () => {
  it("matches a brute-force search", () => {
    const r = rng(1);
    const w = 37;
    const h = 29;
    const target = Uint8Array.from({ length: w * h }, () => (r() < 0.04 ? 1 : 0));
    target[5] = 1;
    const nearest = new Int32Array(w * h);
    const d = distanceSquared(target, w, h, nearest);
    for (let i = 0; i < w * h; i++) {
      let best = Infinity;
      for (let j = 0; j < w * h; j++) {
        if (!target[j]) continue;
        best = Math.min(best, (((i / w) | 0) - ((j / w) | 0)) ** 2 + ((i % w) - (j % w)) ** 2);
      }
      expect(d[i]).toBe(best);
      expect(target[nearest[i]]).toBe(1);
    }
  });

  it("opening removes what a disk cannot reach and keeps what it can", () => {
    const w = 80;
    const h = 40;
    const m = new Uint8Array(w * h);
    for (let y = 10; y < 30; y++) for (let x = 5; x < 25; x++) m[y * w + x] = 1;
    for (let x = 25; x < 70; x++) m[20 * w + x] = 1;
    const o = opened(m, w, h, 4);
    expect(o[20 * w + 15]).toBe(1);
    expect(o[20 * w + 50]).toBe(0);
  });
});

describe("regions", () => {
  it("counts four-connected areas", () => {
    const m = Uint8Array.from([1, 0, 1, 0, 1, 0, 1, 1, 1]);
    expect(regionsOf(m, 3, 3).count).toBe(3);
  });
});

describe("chains", () => {
  const map = labelMap(60, 40, (x, y) => {
    if (x < 8 || x >= 52 || y < 8 || y >= 32) return 0;
    if (x > 20 && x < 40 && y > 14 && y < 26) return 2;
    return x < 30 ? 1 : 3;
  });

  it("draws each boundary once, sharing junctions", () => {
    const chains = boundaryChains(map);
    const seen = new Set<string>();
    for (const c of chains) {
      const n = c.exact.length;
      for (let i = 0; i + 1 < n; i++) {
        const a = c.exact[i].join();
        const b = c.exact[i + 1].join();
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    const loose = new Map<number, number>();
    for (const c of chains.filter((x) => !x.closed)) {
      loose.set(c.start, (loose.get(c.start) ?? 0) + 1);
      loose.set(c.end, (loose.get(c.end) ?? 0) + 1);
    }
    for (const n of loose.values()) expect(n).toBeGreaterThanOrEqual(2);
  });

  it("gives curves that never cross", () => {
    const chains = boundaryChains(map);
    expect(findCrossings(chainsToCurves(chains, 0.0127, map.cellMm))).toEqual([]);
  });

  it("keeps one area per region, with holes", () => {
    const chains = boundaryChains(map);
    const areas = cubicAreas(chains, fitChains(chains, map.cellMm));
    expect(areas.get(2)?.length).toBe(1);
    expect(areas.get(1)?.length).toBe(1);
    expect(areas.get(3)?.length).toBe(1);
  });

  it("separates a color touching itself at a corner", () => {
    const m = labelMap(30, 30, (x, y) => {
      const a = x >= 5 && x < 15 && y >= 5 && y < 15;
      const b = x >= 15 && x < 25 && y >= 15 && y < 25;
      return a || b ? 1 : 0;
    });
    const chains = boundaryChains(m);
    const areas = cubicAreas(chains, fitChains(chains, m.cellMm));
    expect(areas.get(1)?.length).toBe(2);
  });

  it("simplify stays inside its tolerance", () => {
    const p = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i / 9) * 10] as [number, number]);
    const s = simplify(p, 0.5);
    expect(s.length).toBeLessThan(60);
    expect(s[0]).toEqual(p[0]);
    expect(s[s.length - 1]).toEqual(p[199]);
  });
});

describe("tracing", () => {
  const ring = (x: number, y: number): Rgb => {
    const d = Math.hypot(x - 100, y - 100);
    return d > 60 && d < 80 ? [20, 40, 120] : [255, 255, 255];
  };

  it("sizes the art to the requested width without distortion", () => {
    const map = traceImage(image(200, 200, ring), { mode: "mask", widthMm: 50 });
    expect(map.width * map.cellMm).toBeCloseTo(50, 0);
    expect(map.height * map.cellMm).toBeCloseTo(50, 0);
  });

  it("stays inside the cell budget", () => {
    const map = traceImage(image(200, 200, ring), { mode: "mask", widthMm: 500, maxCells: 200_000 });
    expect(map.width * map.height).toBeLessThanOrEqual(210_000);
  });

  it("keeps enclosed background as its own color only when asked", () => {
    const palette: Rgb[] = [
      [255, 255, 255],
      [20, 40, 120],
    ];
    const plain = traceImage(image(200, 200, ring), { mode: "colors", palette, widthMm: 50 });
    const kept = traceImage(image(200, 200, ring), { mode: "colors", palette, widthMm: 50, keepEnclosed: true });
    expect(plain.names.length).toBe(2);
    expect(kept.names).toEqual(["background", "color1", "inner"]);
    expect(kept.data.includes(2)).toBe(true);
  });

  it("reads two flat colors as line art, and ignores anti-aliased blends", () => {
    const soft = (x: number, y: number): Rgb => {
      const d = Math.hypot(x - 100, y - 100);
      const t = Math.min(Math.max((d - 40) / 16, 0), 1);
      return [Math.round(20 + t * 235), Math.round(40 + t * 215), Math.round(120 + t * 135)];
    };
    const s = suggestTrace(image(200, 200, soft));
    expect(s.mode).toBe("mask");
    expect(s.palette.length).toBe(2);
    expect(s.palette[0][0]).toBeGreaterThan(200);
  });

  it("explains an image with nothing to trace", () => {
    expect(() =>
      traceImage(
        image(50, 50, () => [9, 9, 9]),
        { mode: "mask", widthMm: 10 },
      ),
    ).toThrow(/single color/);
  });
});

describe("nozzle fit", () => {
  const hairline = labelMap(400, 200, (x, y) => {
    if (y >= 95 && y < 99 && x > 20 && x < 380) return 1;
    return 0;
  });

  it("widens a hairline until a nozzle can print it", () => {
    const { map, report } = fitToNozzle(hairline, { nozzleMm: 0.4 });
    expect(report.features[1].count).toBe(0);
    const mask = Uint8Array.from(map.data, (v) => (v === 1 ? 1 : 0));
    expect(thinSpots(mask, map.width, map.height, 0.42 / map.cellMm).some((v) => v)).toBe(false);
  });

  it("closes a gap narrower than the nozzle", () => {
    const pair = labelMap(300, 200, (x, y) => {
      if (x < 20 || x >= 280) return 0;
      return (y >= 60 && y < 96) || (y >= 100 && y < 136) ? 1 : 0;
    });
    const { report } = fitToNozzle(pair, { nozzleMm: 0.4 });
    expect(report.gap.count).toBe(0);
    expect(report.changedPct).toBeGreaterThan(0);
  });

  it("leaves art alone when it is already wide enough", () => {
    const wide = labelMap(300, 200, (x, y) => (x > 40 && x < 260 && y > 40 && y < 160 ? 1 : 0));
    expect(fitToNozzle(wide, { nozzleMm: 0.4 }).report.changedPct).toBeLessThan(1);
  });
});

describe("lengths", () => {
  it("reads units", () => {
    expect(parseLength("5in")).toBeCloseTo(127);
    expect(parseLength('5"')).toBeCloseTo(127);
    expect(parseLength("12.7cm")).toBeCloseTo(127);
    expect(parseLength("127")).toBe(127);
    expect(parseLength("5", "in")).toBeCloseTo(127);
    expect(parseLength("x")).toBeNull();
  });
});
