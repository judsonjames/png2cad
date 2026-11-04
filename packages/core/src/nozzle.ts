/**
 * Fit a label map to a nozzle: no printed feature thinner than the nozzle can lay down, no gap narrower than it can
 * leave open.
 *
 * A feature is any non-background label; in a multi-color print each color is a feature of its own filament. A gap is
 * background. Thin means the part of a region that a disk of the minimum width cannot reach (morphological opening):
 * a round cap exactly the minimum width is not thin, a hairline is. Bits at sharp convex corners under half a width
 * squared are ignored.
 *
 * Defaults are 1.05 x nozzle for features and 1.0 x for gaps: lines fitted to exactly one nozzle width left gaps in
 * slices. Where a feature and its neighboring gap cannot both reach their minimums, the fit runs a few rounds and then
 * reports the spots that still conflict.
 */
import {
  cropGrid,
  distanceSquared,
  opened,
  padGrid,
  reassign,
  regionsOf,
  resizeNearest,
  thin,
  type LabelMap,
  type Mask,
} from "./grid.ts";

export interface FitOptions {
  nozzleMm: number;
  featureFactor?: number;
  gapFactor?: number;
  /** fill closes narrow gaps smoothly; open first pushes features back to keep them. */
  gaps?: "fill" | "open";
  /** widen thickens thin spots; remove merges them away. */
  thinFeatures?: "widen" | "remove";
}

export interface SpotReport {
  count: number;
  areaMm2: number;
}

export interface FitReport {
  nozzleMm: number;
  minFeatureMm: number;
  minGapMm: number;
  /** Per feature label, what is still thinner than the minimum. */
  features: Record<number, SpotReport>;
  gap: SpotReport;
  /** Share of the artwork's area the fit moved, in percent. */
  changedPct: number;
  widthMm: number;
  heightMm: number;
}

function maskOf(lab: Uint8Array, v: number): Mask {
  const m = new Uint8Array(lab.length);
  for (let i = 0; i < lab.length; i++) m[i] = lab[i] === v ? 1 : 0;
  return m;
}

/** Cells of the mask in parts narrower than widthCells, leaving out corner crumbs. */
export function thinSpots(mask: Mask, w: number, h: number, widthCells: number): Mask {
  const open = opened(mask, w, h, (0.98 * widthCells) / 2);
  const t = new Uint8Array(mask.length);
  let any = false;
  for (let i = 0; i < t.length; i++) {
    if (mask[i] && !open[i]) {
      t[i] = 1;
      any = true;
    }
  }
  if (!any) return t;
  const r = regionsOf(t, w, h);
  const least = 0.5 * widthCells ** 2;
  for (let i = 0; i < t.length; i++) if (t[i] && r.sizes[r.ids[i]] < least) t[i] = 0;
  return t;
}

function spotReport(thinMask: Mask, w: number, h: number, cellMm: number): SpotReport {
  const r = regionsOf(thinMask, w, h);
  let cells = 0;
  for (let i = 1; i <= r.count; i++) cells += r.sizes[i];
  return { count: r.count, areaMm2: cells * cellMm * cellMm };
}

/** A window around one region, kept inside the map. */
function windowOf(boxes: Int32Array, i: number, margin: number, w: number, h: number) {
  return {
    x0: Math.max(boxes[i * 4] - margin, 0),
    y0: Math.max(boxes[i * 4 + 1] - margin, 0),
    x1: Math.min(boxes[i * 4 + 2] + margin, w),
    y1: Math.min(boxes[i * 4 + 3] + margin, h),
  };
}

/** Grow label v around its centerline where it is thin, to widthCells wide. Windowed, so large maps stay fast. */
function widen(lab: Uint8Array, w: number, h: number, v: number, thinMask: Mask, widthCells: number): Uint8Array {
  const r = regionsOf(thinMask, w, h);
  if (!r.count) return lab;
  const out = lab.slice();
  const margin = Math.ceil(2 * widthCells) + 4;
  const reach2 = widthCells ** 2;
  const half2 = (widthCells / 2) ** 2;
  for (let id = 1; id <= r.count; id++) {
    const box = windowOf(r.boxes, id, margin, w, h);
    const ww = box.x1 - box.x0;
    const wh = box.y1 - box.y0;
    const sub = new Uint8Array(ww * wh);
    const spot = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const i = (y + box.y0) * w + x + box.x0;
        sub[y * ww + x] = out[i] === v ? 1 : 0;
        spot[y * ww + x] = thinMask[i];
      }
    }
    const near = distanceSquared(spot, ww, wh);
    // Thin only the band around the spot: the centerline there is all that matters, and it bounds the work.
    for (let i = 0; i < sub.length; i++) if (near[i] > 4 * reach2) sub[i] = 0;
    const skeleton = thin(sub, ww, wh);
    let any = false;
    for (let i = 0; i < skeleton.length; i++) {
      if (skeleton[i] && near[i] > reach2) skeleton[i] = 0;
      if (skeleton[i]) any = true;
    }
    if (!any) continue;
    const grow = distanceSquared(skeleton, ww, wh);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        if (grow[y * ww + x] <= half2) out[(y + box.y0) * w + x + box.x0] = v;
      }
    }
  }
  return out;
}

/**
 * Split thin spots into lines (centerline longer than 2 x width: always widened) and short bits. A short bit mostly
 * bordered by another feature color is merged into it, since widening it would eat that color; the sharp inner corner
 * of a letter is the usual case. One bordered by background is widened.
 */
function classify(lab: Uint8Array, w: number, h: number, v: number, mask: Mask, thinMask: Mask, widthCells: number) {
  const r = regionsOf(thinMask, w, h);
  const merge = new Uint8Array(lab.length);
  const grow = new Uint8Array(lab.length);
  const margin = Math.ceil(widthCells) + 4;
  const ring = 3;
  for (let id = 1; id <= r.count; id++) {
    const box = windowOf(r.boxes, id, margin, w, h);
    const ww = box.x1 - box.x0;
    const wh = box.y1 - box.y0;
    const sub = new Uint8Array(ww * wh);
    const here = new Uint8Array(ww * wh);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const i = (y + box.y0) * w + x + box.x0;
        sub[y * ww + x] = mask[i];
        here[y * ww + x] = r.ids[i] === id ? 1 : 0;
      }
    }
    const away = distanceSquared(here, ww, wh);
    for (let i = 0; i < sub.length; i++) if (away[i] > (2 * widthCells) ** 2) sub[i] = 0;
    const skeleton = thin(sub, ww, wh);
    let length = 0;
    let around = 0;
    let feature = 0;
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const k = y * ww + x;
        if (here[k] && skeleton[k]) length++;
        if (!here[k] && away[k] <= ring * ring) {
          const value = lab[(y + box.y0) * w + x + box.x0];
          if (value !== v) {
            around++;
            if (value !== 0) feature++;
          }
        }
      }
    }
    const isLine = length >= 2 * widthCells;
    const eat = !isLine && around > 0 && feature > 0.5 * around;
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        if (!here[y * ww + x]) continue;
        const i = (y + box.y0) * w + x + box.x0;
        if (eat) merge[i] = 1;
        else grow[i] = 1;
      }
    }
  }
  return { merge, grow };
}

function fixFeatures(
  lab: Uint8Array,
  w: number,
  h: number,
  labels: number[],
  widthCells: number,
  mode: "widen" | "remove",
): { out: Uint8Array; changed: boolean } {
  let out = lab;
  let changed = false;
  for (const v of labels) {
    const m = maskOf(out, v);
    const t = thinSpots(m, w, h, widthCells);
    if (!t.some((x) => x)) continue;
    changed = true;
    if (mode === "remove") {
      out = reassign(out, w, h, t);
      continue;
    }
    const { merge, grow } = classify(out, w, h, v, m, t, widthCells);
    out = reassign(out, w, h, merge);
    out = widen(out, w, h, v, grow, widthCells);
  }
  return { out, changed };
}

/** Fill every gap narrower than widthCells (closing all features together), each filled cell going to its nearest. */
function closeGaps(lab: Uint8Array, w: number, h: number, widthCells: number): Uint8Array {
  const r = widthCells / 2;
  const fg = new Uint8Array(lab.length);
  for (let i = 0; i < fg.length; i++) fg[i] = lab[i] ? 1 : 0;
  const reach = distanceSquared(fg, w, h);
  const clear = new Uint8Array(lab.length);
  for (let i = 0; i < clear.length; i++) clear[i] = reach[i] <= r * r ? 0 : 1;
  const back = distanceSquared(clear, w, h);
  const fill = new Uint8Array(lab.length);
  const limit = Math.max(r - 0.5, 0) ** 2;
  for (let i = 0; i < fill.length; i++) fill[i] = !fg[i] && back[i] >= limit ? 1 : 0;
  return reassign(lab, w, h, fill);
}

/** Light blur per label and re-pick, to round off ragged steps the fixes leave behind. */
function smoothLabels(lab: Uint8Array, w: number, h: number, sigma: number, labels: number[]): Uint8Array {
  if (sigma < 0.5) return lab;
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp((-i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const best = new Float32Array(lab.length).fill(-1);
  const out = new Uint8Array(lab.length);
  const row = new Float32Array(lab.length);
  const col = new Float32Array(lab.length);
  for (const v of [0, ...labels]) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
          if (lab[y * w + xx] === v) acc += kernel[k + radius];
        }
        row[y * w + x] = acc;
      }
    }
    col.fill(0);
    for (let y = 0; y < h; y++) {
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        const weight = kernel[k + radius];
        for (let x = 0; x < w; x++) col[y * w + x] += row[yy * w + x] * weight;
      }
    }
    for (let i = 0; i < out.length; i++) {
      if (col[i] > best[i]) {
        best[i] = col[i];
        out[i] = v;
      }
    }
  }
  return out;
}

function settle(
  start: Uint8Array,
  w: number,
  h: number,
  labels: number[],
  wf: number,
  wg: number,
  mode: "widen" | "remove",
): Uint8Array {
  let out = start;
  for (let t = 0; t < 4; t++) {
    const fixed = fixFeatures(out, w, h, labels, wf, mode);
    out = fixed.out;
    let changed = fixed.changed;
    if (thinSpots(maskOf(out, 0), w, h, wg).some((x) => x)) {
      changed = true;
      out = closeGaps(out, w, h, wg); // never makes a feature thinner
    }
    if (!changed) break;
  }
  return out;
}

function fitOnce(map: LabelMap, o: Required<FitOptions>): { map: LabelMap; report: FitReport } {
  const { width: w0, height: h0, cellMm: g } = map;
  const wf = (o.featureFactor * o.nozzleMm) / g;
  const wg = (o.gapFactor * o.nozzleMm) / g;
  const labels: number[] = [];
  for (let v = 1; v < map.names.length; v++) if (map.data.includes(v)) labels.push(v);
  // Room outside the art, so the map's edge is not read as a gap.
  const pad = Math.ceil(Math.max(wf, wg)) + 4;
  const base = padGrid(map.data, w0, h0, pad);
  const w = w0 + 2 * pad;
  const h = h0 + 2 * pad;
  let out = base;
  if (o.gaps === "open") {
    for (let round = 0; round < 2; round++) {
      out = fixFeatures(out, w, h, labels, wf, o.thinFeatures).out;
      const t = thinSpots(maskOf(out, 0), w, h, wg);
      if (t.some((x) => x)) out = widen(out, w, h, 0, t, wg);
    }
  }
  out = settle(out, w, h, labels, wf, wg, o.thinFeatures);
  out = smoothLabels(out, w, h, 0.12 * Math.min(wf, wg), labels);
  out = settle(out, w, h, labels, wf, wg, o.thinFeatures);
  let art = 0;
  let moved = 0;
  for (let i = 0; i < out.length; i++) {
    if (base[i]) art++;
    if (out[i] !== base[i]) moved++;
  }
  const features: Record<number, SpotReport> = {};
  for (const v of labels) features[v] = spotReport(thinSpots(maskOf(out, v), w, h, wf), w, h, g);
  const gap = spotReport(thinSpots(maskOf(out, 0), w, h, wg), w, h, g);
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!out[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
    }
  }
  const m = 2;
  const box = { x0: Math.max(x0 - m, 0), y0: Math.max(y0 - m, 0), x1: Math.min(x1 + m, w), y1: Math.min(y1 + m, h) };
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  return {
    map: { ...map, data: cropGrid(out, w, box), width: cw, height: ch },
    report: {
      nozzleMm: o.nozzleMm,
      minFeatureMm: o.featureFactor * o.nozzleMm,
      minGapMm: o.gapFactor * o.nozzleMm,
      features,
      gap,
      changedPct: Math.round((1000 * moved) / Math.max(art, 1)) / 10,
      widthMm: cw * g,
      heightMm: ch * g,
    },
  };
}

function every2(map: LabelMap): LabelMap {
  const w = Math.ceil(map.width / 2);
  const h = Math.ceil(map.height / 2);
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data[y * w + x] = map.data[2 * y * map.width + 2 * x];
  }
  return { ...map, data, width: w, height: h, cellMm: map.cellMm * 2 };
}

export interface FitBox {
  widthMm?: number;
  heightMm?: number;
}

/**
 * Fit to one nozzle inside a size box. The map is rescaled to the box, and if widened tips at the edges push it past
 * the box, the source is shrunk slightly and fitted again.
 */
export function fitToNozzle(
  source: LabelMap,
  options: FitOptions,
  box: FitBox = {},
): { map: LabelMap; report: FitReport } {
  const o: Required<FitOptions> = {
    featureFactor: 1.05,
    gapFactor: 1,
    gaps: "fill",
    thinFeatures: "widen",
    ...options,
  };
  // Coarser than two cells breaks thin lines into dashes that then get filled as gaps.
  const src = o.nozzleMm / (2 * source.cellMm) >= 12 ? every2(source) : source;
  const curW = src.width * src.cellMm;
  const curH = src.height * src.cellMm;
  const fits: number[] = [];
  if (box.widthMm) fits.push(box.widthMm / curW);
  if (box.heightMm) fits.push(box.heightMm / curH);
  let scale = fits.length ? Math.min(...fits) : 1;
  let result!: ReturnType<typeof fitOnce>;
  for (let t = 0; t < 5; t++) {
    const work =
      Math.abs(scale - 1) < 1e-6
        ? src
        : {
            ...src,
            data: resizeNearest(
              src.data,
              src.width,
              src.height,
              Math.round(src.width * scale),
              Math.round(src.height * scale),
            ),
            width: Math.round(src.width * scale),
            height: Math.round(src.height * scale),
          };
    result = fitOnce(work, o);
    const over = Math.max(
      box.widthMm ? result.report.widthMm / box.widthMm : 0,
      box.heightMm ? result.report.heightMm / box.heightMm : 0,
    );
    if (over <= 1.0005) break;
    scale /= over * 1.001;
  }
  return result;
}
