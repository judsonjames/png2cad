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

describe("widening lines that meet", () => {
  /** Thin lines of uneven width crossing, as in traced line art: only parts of each are under the minimum. */
  const grid = labelMap(900, 600, (x, y) => {
    const wide = 5 + 2.5 * Math.sin(x / 37) + 1.5 * Math.sin(x / 11);
    const tall = 5 + 2.5 * Math.sin(y / 29) + 1.5 * Math.sin(y / 13);
    const across = [150, 300, 450].some((c) => Math.abs(y - c - 6 * Math.sin(x / 90)) < wide);
    const down = [180, 450, 720].some((c) => Math.abs(x - c - 6 * Math.sin(y / 80)) < tall);
    return (across || down) && x > 40 && x < 860 && y > 40 && y < 560 ? 1 : 0;
  });

  it("gives even lines: no blobs where they meet, no nubs along them", () => {
    const { map } = fitToNozzle(grid, { nozzleMm: 0.4 });
    const w = map.width;
    const h = map.height;
    const lineCells = 0.42 / map.cellMm;
    const art = Uint8Array.from(map.data, (v) => (v ? 1 : 0));
    const inside = distanceSquared(
      Uint8Array.from(art, (v) => 1 - v),
      w,
      h,
    );
    let widest = 0;
    for (const d of inside) widest = Math.max(widest, Math.sqrt(d));
    // A crossing of two lines of width L holds a circle of radius about 0.71 L.
    expect(widest / lineCells).toBeLessThan(1); // 1.59 when false branches were widened
    // Between crossings, a line's width stays even.
    const y0 = Math.round(h * 0.25);
    const widths: number[] = [];
    for (let x = Math.round(w * 0.32); x < w * 0.45; x++) {
      let run = 0;
      for (let y = y0 - 40; y < y0 + 40; y++) if (art[y * w + x]) run++;
      widths.push(run);
    }
    expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.5);
  });
});

describe("low-resolution line art", () => {
  /** Hard-edged curved strokes at about the resolution of a logo saved for the web. */
  function strokes() {
    const w = 900;
    const h = 300;
    const paths = [
      (x: number) => 90 + 40 * Math.sin(x / 70),
      (x: number) => 150 + 30 * Math.sin(x / 45 + 1),
      (x: number) => 215 + 25 * Math.sin(x / 95 + 2),
    ];
    return image(w, h, (x, y) => {
      if (x < 30 || x >= w - 30) return [0, 191, 99];
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          if (paths.some((f, i) => Math.abs(py - f(px)) < 1.1 + i * 0.9)) cover++;
        }
      }
      const t = cover >= 8 ? 1 : 0; // hard pixels, as in a flat logo saved without anti-aliasing
      return [Math.round(255 * t), Math.round(191 + 64 * t), Math.round(99 + 156 * t)];
    });
  }

  it("smooths the pixel staircase, so the fit has little to repair", () => {
    const map = traceImage(strokes(), { mode: "mask", widthMm: 100 });
    const fine = fitToNozzle(map, { nozzleMm: 0.2 }, { widthMm: 100 }).report;
    const coarse = fitToNozzle(map, { nozzleMm: 0.4 }, { widthMm: 100 }).report;
    expect(fine.gap.count).toBe(0);
    expect(coarse.gap.count).toBe(0);
    expect(fine.changedPct).toBeLessThan(5);
    expect(fine.changedPct).toBeLessThan(coarse.changedPct);
  });

  it("gives edges that do not follow the source pixels", () => {
    const map = traceImage(strokes(), { mode: "mask", widthMm: 100, maxCells: 8_000_000 });
    // Each step of a staircase is a sharp turn. A smooth stroke has few of them.
    const chains = boundaryChains(map);
    let sharp = 0;
    let points = 0;
    for (const c of chains) {
      const p = c.points;
      const k = 6;
      for (let i = k; i + k < p.length; i += k) {
        const a = Math.atan2(p[i][1] - p[i - k][1], p[i][0] - p[i - k][0]);
        const b = Math.atan2(p[i + k][1] - p[i][1], p[i + k][0] - p[i][0]);
        const d = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
        if (d > 0.5) sharp++;
        points++;
      }
    }
    expect(sharp / points).toBeLessThan(0.25); // 0.33 when the blur ran before enlarging
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

describe("fit progress", () => {
  const art = labelMap(600, 200, (x, y) =>
    Math.abs(y - 100 - 20 * Math.sin(x / 50)) < 4 && x > 40 && x < 560 ? 1 : 0,
  );

  it("only moves forward, says what it is doing, and changes nothing in the result", () => {
    const steps: [string, number][] = [];
    const told = fitToNozzle(art, { nozzleMm: 0.4 }, { widthMm: 14 }, (message, done) => steps.push([message, done]));
    const quiet = fitToNozzle(art, { nozzleMm: 0.4 }, { widthMm: 14 });
    expect(new Set(steps.map((s) => s[0].replace(" again", ""))).size).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < steps.length; i++) expect(steps[i][1]).toBeGreaterThanOrEqual(steps[i - 1][1]);
    expect(steps[steps.length - 1][1]).toBeGreaterThan(0.5);
    expect(steps[steps.length - 1][1]).toBeLessThanOrEqual(1);
    expect(told.map.data).toEqual(quiet.map.data);
  });

  it("reports through a trace", () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) {
      const on = i % 64 > 20 && i % 64 < 44 && i >> 6 > 20 && i >> 6 < 44;
      pixels.set(on ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
    }
    const seen: number[] = [];
    traceImage({ data: pixels, width: 64, height: 64 }, { mode: "mask", widthMm: 20, onProgress: (d) => seen.push(d) });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});

describe("faint thin lines", () => {
  /** A ring one pixel wide and partly covered, as in a small emblem saved at low resolution. */
  function faintRing() {
    const size = 60;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const edge = Math.abs(Math.hypot(x - 30, y - 30) - 12);
        const v = Math.round(255 * 0.8 * Math.max(0, 1 - edge));
        data.set([v, v, v, 255], (y * size + x) * 4);
      }
    }
    // Something solid beside it, so the art's brightest color is white as in real line art.
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) data.set([255, 255, 255, 255], (y * size + x) * 4);
    return { data, width: size, height: size };
  }
  const holes = (map: LabelMap) => {
    const clear = Uint8Array.from(map.data, (v) => (v ? 0 : 1));
    return regionsOf(clear, map.width, map.height).count;
  };

  it("keeps a faint ring closed, where a plain cut breaks it", () => {
    const options = {
      mode: "mask" as const,
      widthMm: 30,
      background: [0, 0, 0] as Rgb,
      foreground: [255, 255, 255] as Rgb,
      speckMm: 0.05,
    };
    expect(holes(traceImage(faintRing(), { ...options, sharpen: 0 }))).toBe(1);
    expect(holes(traceImage(faintRing(), options))).toBe(2);
  });
});

describe("blended edge pixels", () => {
  const white: Rgb = [253, 253, 253];
  const navy: Rgb = [2, 19, 50];
  const red: Rgb = [180, 21, 27];
  const gray: Rgb = [128, 128, 128];

  /** A soft-edged navy disc on white, with a red block well away from it. */
  function disc(palette: Rgb[], middle: Rgb) {
    const size = 80;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = Math.min(Math.max(Math.hypot(x - 30, y - 40) - 18, 0), 1.6) / 1.6;
        const c = [0, 1, 2].map((k) => navy[k] + t * (white[k] - navy[k]));
        data.set([...c, 255], (y * size + x) * 4);
        if (x > 62 && x < 76 && y > 30 && y < 50) data.set([...middle, 255], (y * size + x) * 4);
      }
    }
    return traceImage({ data, width: size, height: size }, { mode: "colors", palette, widthMm: 40, speckMm: 0.02 });
  }

  it("never turns the edge between two colors into a third", () => {
    const map = disc([white, navy, red], red);
    const third = 2;
    const cut = Math.round(map.width * 0.7); // Left of here is only the disc and its edge.
    let fringe = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < cut; x++) if (map.data[y * map.width + x] === third) fringe++;
    }
    expect(fringe).toBe(0);
    expect(map.data.includes(third)).toBe(true);
  });

  it("keeps a real color that sits between two others", () => {
    const map = disc([white, navy, gray], gray);
    let kept = 0;
    for (const v of map.data) if (v === 2) kept++;
    expect(kept / map.data.length).toBeGreaterThan(0.02);
  });
});

describe("clean edges", () => {
  it("evens out a ragged line", () => {
    const random = rng(7);
    const wobble = Array.from({ length: 200 }, () => 6 * (random() - 0.5));
    const line = labelMap(900, 200, (x, y) => {
      const c = 100 + wobble[Math.floor(x / 6)];
      return Math.abs(y - c) < 5 && x > 40 && x < 860 ? 1 : 0;
    });
    const { map } = fitToNozzle(line, { nozzleMm: 0.4 });
    let travel = 0;
    let last = -1;
    for (let x = Math.round(map.width * 0.2); x < map.width * 0.8; x++) {
      let top = 0;
      while (top < map.height && !map.data[top * map.width + x]) top++;
      if (last >= 0) travel += Math.abs(top - last);
      last = top;
    }
    expect(travel).toBeLessThan(60); // 96 with a light blur
  });

  it("leaves no cell steps along a nearly straight edge on a coarse grid", () => {
    const coarse = labelMap(1000, 120, (x, y) => (Math.abs(y - 60 - x / 40) < 20 && x > 20 && x < 980 ? 1 : 0));
    const curves = chainsToCurves(boundaryChains(coarse), 0.0127, coarse.cellMm);
    expect(curves.reduce((n, c) => n + c.points.length, 0)).toBeLessThan(20); // 108 when each step survived
  });
});
