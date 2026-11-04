/** Raster building blocks on plain typed arrays: distance transforms, connected regions, filters and resampling. */

export type Mask = Uint8Array;

export interface LabelMap {
  /** One label per cell, row 0 at the top. Label 0 is background and is not part of the artwork. */
  data: Uint8Array;
  width: number;
  height: number;
  /** Size of one cell in millimeters. */
  cellMm: number;
  names: string[];
  /** One [r, g, b] per label, background included. */
  colors: [number, number, number][];
}

const INF = 1e20;

/** One line of the exact squared distance transform (Felzenszwalb and Huttenlocher). */
function envelope(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  arg: Int32Array | null,
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    const fq = f[q] + q * q;
    let s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (fq - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
    if (arg) arg[q] = v[k];
  }
}

/**
 * Squared distance from each cell to the nearest cell where `target` is nonzero. With `nearest`, also fills each
 * cell's index of that nearest target cell.
 */
export function distanceSquared(target: Mask, w: number, h: number, nearest?: Int32Array): Float32Array {
  const out = new Float32Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const arg = nearest ? new Int32Array(n) : null;
  const rowOf = nearest ? new Int32Array(w * h) : null;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = target[y * w + x] ? 0 : INF;
    envelope(f, h, d, v, z, arg);
    for (let y = 0; y < h; y++) {
      out[y * w + x] = d[y];
      if (rowOf && arg) rowOf[y * w + x] = arg[y];
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = out[row + x];
    envelope(f, w, d, v, z, arg);
    for (let x = 0; x < w; x++) {
      out[row + x] = d[x];
      if (nearest && rowOf && arg) nearest[row + x] = rowOf[row + arg[x]] * w + arg[x];
    }
  }
  return out;
}

/** Distance from each set cell to the nearest clear cell, squared. The map's edge is not a boundary. */
export function insideDistanceSquared(mask: Mask, w: number, h: number): Float32Array {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  return distanceSquared(inv, w, h);
}

/** Morphological opening with a disk of radius r cells. */
export function opened(mask: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return mask;
  const r2 = r * r;
  const inside = insideDistanceSquared(mask, w, h);
  const core = new Uint8Array(w * h);
  for (let i = 0; i < core.length; i++) core[i] = inside[i] > r2 ? 1 : 0;
  const away = distanceSquared(core, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = away[i] <= r2 ? 1 : 0;
  return out;
}

export interface Regions {
  /** Region number per cell, 0 where the mask is clear. */
  ids: Int32Array;
  count: number;
  /** Cell count per region, index 0 unused. */
  sizes: Int32Array;
  /** Bounding boxes per region: x0, y0, x1, y1 (end exclusive), index 0 unused. */
  boxes: Int32Array;
}

/** Connected regions of a mask, four-connected, by flood fill. */
export function regionsOf(mask: Mask, w: number, h: number): Regions {
  const ids = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const sizes: number[] = [0];
  const boxes: number[] = [0, 0, 0, 0];
  let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || ids[i]) continue;
    count++;
    let top = 0;
    let size = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    stack[top++] = i;
    ids[i] = count;
    while (top) {
      const c = stack[--top];
      const y = (c / w) | 0;
      const x = c - y * w;
      size++;
      if (x < x0) x0 = x;
      if (x >= x1) x1 = x + 1;
      if (y < y0) y0 = y;
      if (y >= y1) y1 = y + 1;
      if (x > 0 && mask[c - 1] && !ids[c - 1]) {
        ids[c - 1] = count;
        stack[top++] = c - 1;
      }
      if (x + 1 < w && mask[c + 1] && !ids[c + 1]) {
        ids[c + 1] = count;
        stack[top++] = c + 1;
      }
      if (y > 0 && mask[c - w] && !ids[c - w]) {
        ids[c - w] = count;
        stack[top++] = c - w;
      }
      if (y + 1 < h && mask[c + w] && !ids[c + w]) {
        ids[c + w] = count;
        stack[top++] = c + w;
      }
    }
    sizes.push(size);
    boxes.push(x0, y0, x1, y1);
  }
  return { ids, count, sizes: Int32Array.from(sizes), boxes: Int32Array.from(boxes) };
}

/** Give each cell in `region` the label of the nearest cell outside it. */
export function reassign(lab: Uint8Array, w: number, h: number, region: Mask): Uint8Array {
  let any = false;
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < keep.length; i++) {
    keep[i] = region[i] ? 0 : 1;
    if (region[i]) any = true;
  }
  if (!any) return lab;
  const nearest = new Int32Array(w * h);
  distanceSquared(keep, w, h, nearest);
  const out = lab.slice();
  for (let i = 0; i < out.length; i++) if (region[i]) out[i] = lab[nearest[i]];
  return out;
}

/**
 * Zhang-Suen thinning, in place. Worked on a copy with a clear border, so shapes reaching the edge of the window thin
 * like any other instead of keeping a frame that grows false branches.
 */
export function thin(mask: Mask, width: number, height: number): Mask {
  const w = width + 2;
  const h = height + 2;
  const m = padGrid(mask, width, height, 1);
  // A cell with no clear neighbor can never be removed, so only the edge of the shape is examined. The result is the
  // same as scanning every cell on every pass, at far less cost on solid areas.
  const ring = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  const listed = new Uint8Array(w * h);
  let edge: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      if (m[c] && ring.some((d) => !m[c + d])) {
        edge.push(c);
        listed[c] = 1;
      }
    }
  }
  let changed = true;
  const list: number[] = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      list.length = 0;
      for (const c of edge) {
        if (!m[c]) continue;
        const p2 = m[c - w];
        const p3 = m[c - w + 1];
        const p4 = m[c + 1];
        const p5 = m[c + w + 1];
        const p6 = m[c + w];
        const p7 = m[c + w - 1];
        const p8 = m[c - 1];
        const p9 = m[c - w - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (!p2 && p3 ? 1 : 0) +
          (!p3 && p4 ? 1 : 0) +
          (!p4 && p5 ? 1 : 0) +
          (!p5 && p6 ? 1 : 0) +
          (!p6 && p7 ? 1 : 0) +
          (!p7 && p8 ? 1 : 0) +
          (!p8 && p9 ? 1 : 0) +
          (!p9 && p2 ? 1 : 0);
        if (a !== 1) continue;
        if (pass === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
        list.push(c);
      }
      if (list.length) changed = true;
      for (const c of list) m[c] = 0;
      for (const c of list) {
        for (const d of ring) {
          if (m[c + d] && !listed[c + d]) {
            listed[c + d] = 1;
            edge.push(c + d);
          }
        }
      }
    }
    edge = edge.filter((c) => m[c]);
  }
  for (let y = 0; y < height; y++) mask.set(m.subarray((y + 1) * w + 1, (y + 1) * w + 1 + width), y * width);
  return mask;
}

/** Separable Gaussian blur of a float image, truncated at four sigma, edges held at their nearest value. */
export function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src;
  const radius = Math.max(1, Math.ceil(sigma * 4));
  const kernel = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp((-i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        acc += src[row + xx] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let k = -radius; k <= radius; k++) {
      const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
      const weight = kernel[k + radius];
      const a = y * w;
      const b = yy * w;
      for (let x = 0; x < w; x++) out[a + x] += tmp[b + x] * weight;
    }
  }
  return out;
}

function cubicWeights(t: number, out: Float64Array): void {
  // Catmull-Rom: passes through the samples, so thin lines keep their strength when enlarged.
  const t2 = t * t;
  const t3 = t2 * t;
  out[0] = -0.5 * t3 + t2 - 0.5 * t;
  out[1] = 1.5 * t3 - 2.5 * t2 + 1;
  out[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  out[3] = 0.5 * t3 - 0.5 * t2;
}

/** Cubic resize. Output cell centers map to source positions so edges stay aligned. */
export function resizeCubic(src: Float32Array, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const tmp = new Float32Array(dw * sh);
  const wt = new Float64Array(4);
  const sx = sw / dw;
  for (let x = 0; x < dw; x++) {
    const p = (x + 0.5) * sx - 0.5;
    const i = Math.floor(p);
    cubicWeights(p - i, wt);
    const i0 = Math.min(Math.max(i - 1, 0), sw - 1);
    const i1 = Math.min(Math.max(i, 0), sw - 1);
    const i2 = Math.min(Math.max(i + 1, 0), sw - 1);
    const i3 = Math.min(Math.max(i + 2, 0), sw - 1);
    for (let y = 0; y < sh; y++) {
      const r = y * sw;
      tmp[y * dw + x] = src[r + i0] * wt[0] + src[r + i1] * wt[1] + src[r + i2] * wt[2] + src[r + i3] * wt[3];
    }
  }
  const out = new Float32Array(dw * dh);
  const sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const p = (y + 0.5) * sy - 0.5;
    const i = Math.floor(p);
    cubicWeights(p - i, wt);
    const r0 = Math.min(Math.max(i - 1, 0), sh - 1) * dw;
    const r1 = Math.min(Math.max(i, 0), sh - 1) * dw;
    const r2 = Math.min(Math.max(i + 1, 0), sh - 1) * dw;
    const r3 = Math.min(Math.max(i + 2, 0), sh - 1) * dw;
    const o = y * dw;
    for (let x = 0; x < dw; x++) {
      out[o + x] = tmp[r0 + x] * wt[0] + tmp[r1 + x] * wt[1] + tmp[r2 + x] * wt[2] + tmp[r3 + x] * wt[3];
    }
  }
  return out;
}

/** Nearest-neighbor resize of a label grid. */
export function resizeNearest(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const r = Math.min(((y + 0.5) * sh) / dh, sh - 1) | 0;
    for (let x = 0; x < dw; x++) out[y * dw + x] = src[r * sw + (Math.min(((x + 0.5) * sw) / dw, sw - 1) | 0)];
  }
  return out;
}

/** Add `pad` clear cells on every side. */
export function padGrid(src: Uint8Array, w: number, h: number, pad: number): Uint8Array {
  const pw = w + 2 * pad;
  const out = new Uint8Array(pw * (h + 2 * pad));
  for (let y = 0; y < h; y++) out.set(src.subarray(y * w, y * w + w), (y + pad) * pw + pad);
  return out;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box of the nonzero cells, or null if there are none. */
export function boundsOf(data: Uint8Array, w: number, h: number): Box | null {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/** Copy a rectangle out of a grid. */
export function cropGrid(src: Uint8Array, w: number, box: Box): Uint8Array {
  const cw = box.x1 - box.x0;
  const out = new Uint8Array(cw * (box.y1 - box.y0));
  for (let y = box.y0; y < box.y1; y++) {
    out.set(src.subarray(y * w + box.x0, y * w + box.x1), (y - box.y0) * cw);
  }
  return out;
}
