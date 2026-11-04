/** Turn an image into a label map. Line and gap widths are not changed here; the nozzle fit does that. */
import {
  boundsOf,
  gaussianBlur,
  reassign,
  regionsOf,
  resizeCubic,
  type Box,
  type LabelMap,
  type Mask,
} from "./grid.ts";

export interface RasterImage {
  /** RGBA, four bytes per pixel, row 0 at the top. */
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export type Rgb = [number, number, number];

export interface TraceOptions {
  mode: "mask" | "colors";
  /** Target box in millimeters. The art fits inside it without distortion. */
  widthMm?: number;
  heightMm?: number;
  /** Colors mode: the palette, background first. Found automatically when left out. */
  palette?: Rgb[];
  /** Colors mode without a palette: how many colors to find, background included. */
  colorCount?: number;
  /** Mask mode: force these instead of reading them from the image. */
  background?: Rgb;
  foreground?: Rgb;
  /** Areas smaller than a square of this side are noise. */
  speckMm?: number;
  /** Most cells the map may hold; the grid coarsens to stay inside it. */
  maxCells?: number;
  /** Finest grid allowed. */
  minCellMm?: number;
  /** Part of the image to use, in pixels. */
  crop?: Box;
  /**
   * Colors mode: background-colored areas fully enclosed by the art become a color of their own, so only the outer
   * background is dropped. Otherwise white parts of a logo on white are cut out and a plate falls into loose pieces.
   */
  keepEnclosed?: boolean;
}

// Files use a 0.0127 mm grid wherever this budget allows. Coarser grids made the nozzle fit unstable on real line art:
// a truck at 100 mm went from 3% changed to 27%, with gaps left. Only previews should go coarser.
const DEFAULT_MAX_CELLS = 32_000_000;
const DEFAULT_MIN_CELL_MM = 0.0127;

function rgbAt(img: RasterImage, i: number): Rgb {
  // Transparent pixels read as white, the way a viewer shows a logo on a page.
  const a = img.data[i * 4 + 3] / 255;
  return [
    img.data[i * 4] * a + 255 * (1 - a),
    img.data[i * 4 + 1] * a + 255 * (1 - a),
    img.data[i * 4 + 2] * a + 255 * (1 - a),
  ];
}

function cropImage(img: RasterImage, box?: Box): RasterImage {
  if (!box) return img;
  const x0 = Math.max(0, Math.round(box.x0));
  const y0 = Math.max(0, Math.round(box.y0));
  const x1 = Math.min(img.width, Math.round(box.x1));
  const y1 = Math.min(img.height, Math.round(box.y1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) throw new Error("The crop is too small. Select at least 2 x 2 pixels.");
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x1) * 4), y * w * 4);
  }
  return { data, width: w, height: h };
}

function borderPixels(img: RasterImage): Rgb[] {
  const out: Rgb[] = [];
  const { width: w, height: h } = img;
  for (let x = 0; x < w; x++) {
    for (const y of [0, 1, h - 2, h - 1]) if (y >= 0 && y < h) out.push(rgbAt(img, y * w + x));
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, 1, w - 2, w - 1]) if (x >= 0 && x < w) out.push(rgbAt(img, y * w + x));
  }
  return out;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function medianColor(colors: Rgb[]): Rgb {
  return [median(colors.map((c) => c[0])), median(colors.map((c) => c[1])), median(colors.map((c) => c[2]))];
}

function dist2(a: Rgb, b: Rgb): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Cell size and map size for a crop, inside the requested box and the cell budget. */
function planGrid(srcW: number, srcH: number, a: TraceOptions) {
  const options: number[] = [];
  if (a.widthMm) options.push(a.widthMm / srcW);
  if (a.heightMm) options.push(a.heightMm / srcH);
  if (!options.length) throw new Error("Enter a width or a height.");
  const mmPerSrc = Math.min(...options);
  const artW = srcW * mmPerSrc;
  const artH = srcH * mmPerSrc;
  const cellMm = Math.max(
    a.minCellMm ?? DEFAULT_MIN_CELL_MM,
    Math.sqrt((artW * artH) / (a.maxCells ?? DEFAULT_MAX_CELLS)),
  );
  return {
    cellMm,
    width: Math.max(2, Math.round(artW / cellMm)),
    height: Math.max(2, Math.round(artH / cellMm)),
    cellsPerSrc: mmPerSrc / cellMm,
  };
}

function contentBox(fg: Mask, w: number, h: number, margin = 1): Box {
  const box = boundsOf(fg, w, h);
  if (!box) throw new Error("No artwork was found. Check the colors, or try the other trace mode.");
  return {
    x0: Math.max(box.x0 - margin, 0),
    y0: Math.max(box.y0 - margin, 0),
    x1: Math.min(box.x1 + margin, w),
    y1: Math.min(box.y1 + margin, h),
  };
}

function cropFloat(src: Float32Array, w: number, box: Box): Float32Array {
  const cw = box.x1 - box.x0;
  const out = new Float32Array(cw * (box.y1 - box.y0));
  for (let y = box.y0; y < box.y1; y++) {
    out.set(src.subarray(y * w + box.x0, y * w + box.x1), (y - box.y0) * cw);
  }
  return out;
}

/** Merge connected areas smaller than minCells into their surroundings. */
export function removeSpecks(lab: Uint8Array, w: number, h: number, minCells: number, labels: number): Uint8Array {
  const bad = new Uint8Array(w * h);
  let any = false;
  const mask = new Uint8Array(w * h);
  for (let v = 0; v < labels; v++) {
    for (let i = 0; i < mask.length; i++) mask[i] = lab[i] === v ? 1 : 0;
    const r = regionsOf(mask, w, h);
    for (let i = 0; i < mask.length; i++) {
      if (r.ids[i] && r.sizes[r.ids[i]] < minCells) {
        bad[i] = 1;
        any = true;
      }
    }
  }
  return any ? reassign(lab, w, h, bad) : lab;
}

function traceMask(img: RasterImage, a: TraceOptions): LabelMap {
  const { width: w, height: h } = img;
  const bg = a.background ?? medianColor(borderPixels(img));
  let fg = a.foreground;
  if (!fg) {
    let far = 0;
    const d = new Float32Array(w * h);
    for (let i = 0; i < d.length; i++) {
      d[i] = Math.sqrt(dist2(rgbAt(img, i), bg));
      if (d[i] > far) far = d[i];
    }
    const picked: Rgb[] = [];
    const step = Math.max(1, Math.floor((w * h) / 200_000));
    for (let i = 0; i < d.length; i += step) if (d[i] > 0.5 * far) picked.push(rgbAt(img, i));
    if (!picked.length) throw new Error("The image is a single color, so there is nothing to trace.");
    fg = medianColor(picked);
  }
  const axis: Rgb = [fg[0] - bg[0], fg[1] - bg[1], fg[2] - bg[2]];
  const len2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
  if (len2 < 1) throw new Error("The foreground and background colors are the same.");
  // Project each pixel onto the background-to-foreground axis: 0 background, 1 foreground, anti-aliasing between.
  const f = new Float32Array(w * h);
  const fgMask = new Uint8Array(w * h);
  for (let i = 0; i < f.length; i++) {
    const c = rgbAt(img, i);
    const t = ((c[0] - bg[0]) * axis[0] + (c[1] - bg[1]) * axis[1] + (c[2] - bg[2]) * axis[2]) / len2;
    f[i] = t < 0 ? 0 : t > 1 ? 1 : t;
    fgMask[i] = f[i] > 0.5 ? 1 : 0;
  }
  const box = contentBox(fgMask, w, h);
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const grid = planGrid(cw, ch, a);
  // Enlarge, then blur. The order matters: a blur of a third of a pixel does almost nothing at source resolution, so
  // the pixel staircase survives, and the nozzle fit then treats every step as detail to repair.
  const enlarged = resizeCubic(cropFloat(f, w, box), cw, ch, grid.width, grid.height);
  const big = gaussianBlur(enlarged, grid.width, grid.height, 0.35 * grid.cellsPerSrc);
  const hard = new Float32Array(big.length);
  for (let i = 0; i < big.length; i++) hard[i] = big[i] > 0.5 ? 1 : 0;
  const smooth = gaussianBlur(hard, grid.width, grid.height, 1.5);
  const lab = new Uint8Array(big.length);
  for (let i = 0; i < lab.length; i++) lab[i] = smooth[i] > 0.5 ? 1 : 0;
  const speck = ((a.speckMm ?? 0.15) / grid.cellMm) ** 2;
  // After smoothing, which can pinch off pinholes.
  return {
    data: removeSpecks(lab, grid.width, grid.height, speck, 2),
    width: grid.width,
    height: grid.height,
    cellMm: grid.cellMm,
    names: ["background", "foreground"],
    colors: [roundColor(bg), roundColor(fg)],
  };
}

function roundColor(c: Rgb): Rgb {
  return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])];
}

/** k-means with farthest-point seeding. Deterministic, so the same image always gives the same palette. */
export function findPalette(img: RasterImage, count: number): Rgb[] {
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 60_000));
  const px: Rgb[] = [];
  for (let i = 0; i < n; i += step) px.push(rgbAt(img, i));
  if (!px.length) throw new Error("The image is empty.");
  const centers: Rgb[] = [medianColor(borderPixels(img))];
  while (centers.length < count) {
    let best = px[0];
    let bestD = -1;
    for (const p of px) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist2(p, c));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    centers.push(best.slice() as Rgb);
  }
  for (let iter = 0; iter < 12; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let k = 0;
      let d = Infinity;
      centers.forEach((c, i) => {
        const e = dist2(p, c);
        if (e < d) {
          d = e;
          k = i;
        }
      });
      sum[k][0] += p[0];
      sum[k][1] += p[1];
      sum[k][2] += p[2];
      sum[k][3]++;
    }
    sum.forEach((s, i) => {
      if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    });
  }
  return centers.map(roundColor);
}

function traceColors(img: RasterImage, a: TraceOptions): LabelMap {
  const { width: w, height: h } = img;
  const given = a.palette ?? findPalette(img, a.colorCount ?? 3);
  if (given.length < 2) throw new Error("Use at least two colors: the background and one for the artwork.");
  // The background is the palette color most common on the border; a palette the person set keeps its first color.
  let bgIndex = 0;
  if (!a.palette) {
    const votes = new Array(given.length).fill(0);
    for (const p of borderPixels(img)) {
      let k = 0;
      let d = Infinity;
      given.forEach((c, i) => {
        const e = dist2(p, c);
        if (e < d) {
          d = e;
          k = i;
        }
      });
      votes[k]++;
    }
    bgIndex = votes.indexOf(Math.max(...votes));
  }
  const pal = [given[bgIndex], ...given.filter((_, i) => i !== bgIndex)];
  let minGap = Infinity;
  for (let i = 0; i < pal.length; i++) {
    for (let j = i + 1; j < pal.length; j++) minGap = Math.min(minGap, Math.sqrt(dist2(pal[i], pal[j])));
  }
  if (minGap < 1) throw new Error("Two palette colors are the same. Change or remove one.");
  // Soft class weights, so anti-aliased edges fall between classes rather than snapping to pixels.
  const sigma2 = 2 * (0.35 * minGap) ** 2;
  const weights = pal.map(() => new Float32Array(w * h));
  const fg = new Uint8Array(w * h);
  const d2 = new Float64Array(pal.length);
  for (let i = 0; i < w * h; i++) {
    const c = rgbAt(img, i);
    let least = Infinity;
    for (let k = 0; k < pal.length; k++) {
      d2[k] = dist2(c, pal[k]);
      if (d2[k] < least) least = d2[k];
    }
    let total = 0;
    for (let k = 0; k < pal.length; k++) {
      const e = Math.exp(-(d2[k] - least) / sigma2);
      weights[k][i] = e;
      total += e;
    }
    for (let k = 0; k < pal.length; k++) weights[k][i] /= total;
    fg[i] = weights[0][i] < 0.5 ? 1 : 0;
  }
  const box = contentBox(fg, w, h);
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const grid = planGrid(cw, ch, a);
  const size = grid.width * grid.height;
  const best = new Float32Array(size).fill(-Infinity);
  const lab = new Uint8Array(size);
  for (let k = 0; k < pal.length; k++) {
    // Keep the highest weight one class at a time, so only two full-size maps are ever held.
    const enlarged = resizeCubic(cropFloat(weights[k], w, box), cw, ch, grid.width, grid.height);
    const big = gaussianBlur(enlarged, grid.width, grid.height, 0.35 * grid.cellsPerSrc);
    for (let i = 0; i < size; i++) {
      if (big[i] > best[i]) {
        best[i] = big[i];
        lab[i] = k;
      }
    }
  }
  const speck = ((a.speckMm ?? 0.15) / grid.cellMm) ** 2;
  const map: LabelMap = {
    data: removeSpecks(lab, grid.width, grid.height, speck, pal.length),
    width: grid.width,
    height: grid.height,
    cellMm: grid.cellMm,
    names: ["background", ...pal.slice(1).map((_, i) => `color${i + 1}`)],
    colors: pal.map(roundColor),
  };
  return a.keepEnclosed ? keepEnclosedAreas(map) : map;
}

/** Give background areas that do not reach the map's edge a label of their own. */
function keepEnclosedAreas(map: LabelMap): LabelMap {
  const { data, width: w, height: h } = map;
  const bg = new Uint8Array(data.length);
  for (let i = 0; i < bg.length; i++) bg[i] = data[i] === 0 ? 1 : 0;
  const r = regionsOf(bg, w, h);
  const outer = new Set<number>();
  for (let x = 0; x < w; x++) {
    outer.add(r.ids[x]);
    outer.add(r.ids[(h - 1) * w + x]);
  }
  for (let y = 0; y < h; y++) {
    outer.add(r.ids[y * w]);
    outer.add(r.ids[y * w + w - 1]);
  }
  const label = map.names.length;
  const out = data.slice();
  let any = false;
  for (let i = 0; i < out.length; i++) {
    if (r.ids[i] && !outer.has(r.ids[i])) {
      out[i] = label;
      any = true;
    }
  }
  if (!any) return map;
  return { ...map, data: out, names: [...map.names, "inner"], colors: [...map.colors, map.colors[0]] };
}

/** Image to label map. Label 0 is background. */
export function traceImage(image: RasterImage, options: TraceOptions): LabelMap {
  const img = cropImage(image, options.crop);
  return options.mode === "mask" ? traceMask(img, options) : traceColors(img, options);
}

function betweenColors(c: Rgb, a: Rgb, b: Rgb): boolean {
  const ab: Rgb = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  if (len2 === 0) return false;
  const t = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / len2;
  if (t < 0.08 || t > 0.92) return false;
  return dist2(c, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]]) < 40 * 40;
}

export interface Suggestion {
  mode: "mask" | "colors";
  /** Background first. */
  palette: Rgb[];
}

/**
 * Read an image's main flat colors, so a dropped file gets a sensible trace with no setup. Colors are binned, then
 * merged while they are closer than a visible step; anything under half a percent of the image is treated as
 * anti-aliasing or noise.
 */
export function suggestTrace(image: RasterImage, crop?: Box): Suggestion {
  const img = cropImage(image, crop);
  const n = img.width * img.height;
  const stride = Math.max(1, Math.floor(n / 400_000));
  const bins = new Map<number, { sum: Rgb; count: number }>();
  let total = 0;
  for (let i = 0; i < n; i += stride) {
    const c = rgbAt(img, i);
    const key = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
    const b = bins.get(key);
    if (b) {
      b.sum[0] += c[0];
      b.sum[1] += c[1];
      b.sum[2] += c[2];
      b.count++;
    } else {
      bins.set(key, { sum: [c[0], c[1], c[2]], count: 1 });
    }
    total++;
  }
  const merged: { color: Rgb; count: number }[] = [];
  for (const b of [...bins.values()].sort((x, y) => y.count - x.count)) {
    const color: Rgb = [b.sum[0] / b.count, b.sum[1] / b.count, b.sum[2] / b.count];
    const near = merged.find((m) => dist2(m.color, color) < 64 * 64);
    if (near) near.count += b.count;
    else merged.push({ color, count: b.count });
  }
  // A minor color lying between two bigger ones is the blend along their shared edge, not a color of its own.
  const main: typeof merged = [];
  for (const m of merged) {
    if (m.count < 0.005 * total || main.length >= 6) continue;
    let blend = false;
    if (m.count < 0.08 * total) {
      for (let i = 0; i < main.length && !blend; i++) {
        for (let j = i + 1; j < main.length && !blend; j++) {
          blend = betweenColors(m.color, main[i].color, main[j].color);
        }
      }
    }
    if (!blend) main.push(m);
  }
  const palette = (main.length >= 2 ? main.map((m) => m.color) : findPalette(img, 2)).map(roundColor);
  // The background is the main color nearest the image's border.
  const edge = medianColor(borderPixels(img));
  let bg = 0;
  palette.forEach((c, i) => {
    if (dist2(c, edge) < dist2(palette[bg], edge)) bg = i;
  });
  const ordered = [palette[bg], ...palette.filter((_, i) => i !== bg)];
  return { mode: ordered.length === 2 ? "mask" : "colors", palette: ordered };
}
