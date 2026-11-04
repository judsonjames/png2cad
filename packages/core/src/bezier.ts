/**
 * Cubic Bezier fitting for boundary chains (Schneider's method). Each chain is fitted once and shared by the colors on
 * both sides, so neighbors meet on identical edges at any scale. Corners are rebuilt where their two sides meet, which
 * undoes the rounding from smoothing the trace; end tangents come from the straight run past it, or straight edges bow.
 */
import {
  findCrossings,
  nestLoops,
  simplify,
  stitch,
  type Area,
  type Chain,
  type Curve,
  type Point,
  type StitchEdge,
} from "./trace.ts";

/** Control points p0, p1, p2, p3. */
export type Cubic = [Point, Point, Point, Point];

const FLAT = 12; // points per cubic in crossing checks; the verifier flattens the same way

export function bezierAt(b: Cubic, u: number): Point {
  const v = 1 - u;
  const a0 = v * v * v;
  const a1 = 3 * u * v * v;
  const a2 = 3 * u * u * v;
  const a3 = u * u * u;
  return [
    a0 * b[0][0] + a1 * b[1][0] + a2 * b[2][0] + a3 * b[3][0],
    a0 * b[0][1] + a1 * b[1][1] + a2 * b[2][1] + a3 * b[3][1],
  ];
}

function unit(v: Point): Point {
  const n = Math.hypot(v[0], v[1]);
  return n > 0 ? [v[0] / n, v[1] / n] : v;
}

function chordParams(p: Point[]): Float64Array {
  const u = new Float64Array(p.length);
  for (let i = 1; i < p.length; i++) u[i] = u[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const total = u[p.length - 1];
  for (let i = 0; i < p.length; i++) u[i] = total > 0 ? u[i] / total : i / (p.length - 1);
  return u;
}

function solveHandles(p: Point[], u: Float64Array, t0: Point, t1: Point): Cubic {
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  const first = p[0];
  const last = p[p.length - 1];
  for (let i = 0; i < p.length; i++) {
    const s = u[i];
    const v = 1 - s;
    const b0 = v * v * v;
    const b1 = 3 * s * v * v;
    const b2 = 3 * s * s * v;
    const b3 = s * s * s;
    const a0x = b1 * t0[0];
    const a0y = b1 * t0[1];
    const a1x = b2 * t1[0];
    const a1y = b2 * t1[1];
    const rx = p[i][0] - ((b0 + b1) * first[0] + (b2 + b3) * last[0]);
    const ry = p[i][1] - ((b0 + b1) * first[1] + (b2 + b3) * last[1]);
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    x0 += a0x * rx + a0y * ry;
    x1 += a1x * rx + a1y * ry;
  }
  const det = c00 * c11 - c01 * c01;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let l0 = 0;
  let l1 = 0;
  if (Math.abs(det) > 1e-18) {
    l0 = (x0 * c11 - x1 * c01) / det;
    l1 = (c00 * x1 - c01 * x0) / det;
  }
  if (l0 < 1e-6 * chord || l1 < 1e-6 * chord || l0 > 3 * chord || l1 > 3 * chord) l0 = l1 = chord / 3;
  return [first, [first[0] + l0 * t0[0], first[1] + l0 * t0[1]], [last[0] + l1 * t1[0], last[1] + l1 * t1[1]], last];
}

function reparameterize(b: Cubic, p: Point[], u: Float64Array): void {
  const d1: Point[] = [0, 1, 2].map((i) => [3 * (b[i + 1][0] - b[i][0]), 3 * (b[i + 1][1] - b[i][1])]);
  const d2: Point[] = [0, 1].map((i) => [2 * (d1[i + 1][0] - d1[i][0]), 2 * (d1[i + 1][1] - d1[i][1])]);
  for (let i = 0; i < p.length; i++) {
    const s = u[i];
    const v = 1 - s;
    const q = bezierAt(b, s);
    const q1x = v * v * d1[0][0] + 2 * s * v * d1[1][0] + s * s * d1[2][0];
    const q1y = v * v * d1[0][1] + 2 * s * v * d1[1][1] + s * s * d1[2][1];
    const q2x = v * d2[0][0] + s * d2[1][0];
    const q2y = v * d2[0][1] + s * d2[1][1];
    const ex = q[0] - p[i][0];
    const ey = q[1] - p[i][1];
    const num = ex * q1x + ey * q1y;
    const den = q1x * q1x + q1y * q1y + ex * q2x + ey * q2y;
    if (Math.abs(den) > 1e-18) u[i] = Math.min(Math.max(s - num / den, 0), 1);
  }
}

function fitSpan(p: Point[], t0: Point, t1: Point, tol: number, reach: number, out: Cubic[]): void {
  const n = p.length;
  if (n < 3) {
    const d = Math.hypot(p[n - 1][0] - p[0][0], p[n - 1][1] - p[0][1]) / 3;
    out.push([
      p[0],
      [p[0][0] + d * t0[0], p[0][1] + d * t0[1]],
      [p[n - 1][0] + d * t1[0], p[n - 1][1] + d * t1[1]],
      p[n - 1],
    ]);
    return;
  }
  const u = chordParams(p);
  let worst = 0;
  for (let t = 0; t < 4; t++) {
    const b = solveHandles(p, u, t0, t1);
    let err = -1;
    for (let i = 0; i < n; i++) {
      const q = bezierAt(b, u[i]);
      const e = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
      if (e > err) {
        err = e;
        worst = i;
      }
    }
    if (err <= tol) {
      out.push(b);
      return;
    }
    if (err > 8 * tol) break;
    reparameterize(b, p, u);
  }
  const split = Math.min(Math.max(worst, 1), n - 2);
  const a = p[Math.max(split - reach, 0)];
  const c = p[Math.min(split + reach, n - 1)];
  const mid = unit([a[0] - c[0], a[1] - c[1]]);
  fitSpan(p.slice(0, split + 1), t0, mid, tol, reach, out);
  fitSpan(p.slice(split), [-mid[0], -mid[1]], t1, tol, reach, out);
}

/** Indices where the path turns sharply, compared over k points each way. */
function findCorners(p: Point[], closed: boolean, k: number, angleDeg: number): number[] {
  const n = p.length;
  if (n < 2 * k + 1) return [];
  const idx: number[] = [];
  const turn: number[] = [];
  const from = closed ? 0 : k;
  const to = closed ? n : n - k;
  for (let i = from; i < to; i++) {
    const a = p[(i - k + n) % n];
    const b = p[(i + k) % n];
    const ax = p[i][0] - a[0];
    const ay = p[i][1] - a[1];
    const bx = b[0] - p[i][0];
    const by = b[1] - p[i][1];
    const cos = (ax * bx + ay * by) / Math.max(Math.hypot(ax, ay) * Math.hypot(bx, by), 1e-12);
    idx.push(i);
    turn.push((Math.acos(Math.min(Math.max(cos, -1), 1)) * 180) / Math.PI);
  }
  const order = idx.map((_, i) => i).sort((a, b) => turn[b] - turn[a]);
  const corners: number[] = [];
  for (const j of order) {
    if (turn[j] < angleDeg) break;
    const c = idx[j];
    if (corners.every((o) => Math.min(Math.abs(c - o), closed ? n - Math.abs(c - o) : n) > k)) corners.push(c);
  }
  return corners.sort((a, b) => a - b);
}

function endTangent(q: Point[], skip: number, cell: number): Point {
  let best: Point | null = null;
  for (const m of [8, 16, 32, 64]) {
    if (skip + m >= q.length) break;
    const a = q[skip];
    const d = unit([q[skip + m][0] - a[0], q[skip + m][1] - a[1]]);
    let far = 0;
    for (let i = skip; i <= skip + m; i++) {
      far = Math.max(far, Math.abs((q[i][0] - a[0]) * -d[1] + (q[i][1] - a[1]) * d[0]));
    }
    if (far > 0.75 * cell) break;
    best = d;
  }
  if (best) return best;
  const a = q[Math.min(skip, q.length - 2)];
  const b = q[Math.min(skip + 4, q.length - 1)];
  return unit([b[0] - a[0], b[1] - a[1]]);
}

function meet(a: Point, da: Point, b: Point, db: Point): Point | null {
  const det = da[0] * db[1] - da[1] * db[0];
  if (Math.abs(det) < 1e-6) return null;
  const s = ((b[0] - a[0]) * db[1] - (b[1] - a[1]) * db[0]) / det;
  return [a[0] + s * da[0], a[1] + s * da[1]];
}

function fitChain(
  points: Point[],
  closed: boolean,
  tol: number,
  k: number,
  angle: number,
  cell: number,
  trim: number,
): Cubic[] {
  const reach = 2 * k; // wide, so the pixel staircase cannot tilt a split
  let p = points.filter((q, i) => i === 0 || q[0] !== points[i - 1][0] || q[1] !== points[i - 1][1]);
  const corners = findCorners(p, closed, k, angle);
  const oneLoop = closed && !corners.length;
  let stops: number[];
  if (closed) {
    const first = corners.length ? corners[0] : 0;
    const n = p.length;
    stops = corners.length ? [...corners.map((c) => c - first), n] : [0, n];
    p = [...p.slice(first), ...p.slice(0, first), p[first]];
  } else {
    stops = [0, ...corners, p.length - 1];
  }
  const spans = stops.slice(0, -1).map((a, i) => p.slice(a, stops[i + 1] + 1));
  const skip = spans.map((q) => (q.length > 2 * trim + 2 ? trim : 0));
  const leave = spans.map((q, i) => endTangent(q, skip[i], cell));
  const arrive = spans.map((q, i) => endTangent(q.slice().reverse(), skip[i], cell));
  const heads = spans.map((q) => q[0]);
  const tails = spans.map((q) => q[q.length - 1]);
  const cutHead = spans.map(() => 1);
  const cutTail = spans.map(() => 1);
  const joints: [number, number][] = spans.slice(0, -1).map((_, i) => [i, i + 1]);
  if (closed && corners.length) joints.push([spans.length - 1, 0]);
  for (const [i, j] of joints) {
    if (!skip[i] || !skip[j]) continue;
    const si = spans[i];
    const x = meet(si[si.length - 1 - trim], arrive[i], spans[j][trim], leave[j]);
    const end = si[si.length - 1];
    if (x && Math.hypot(x[0] - end[0], x[1] - end[1]) <= 6 * cell) {
      tails[i] = x;
      heads[j] = x;
      cutTail[i] = trim;
      cutHead[j] = trim;
    }
  }
  const out: Cubic[] = [];
  spans.forEach((span, n) => {
    const q = [heads[n], ...span.slice(cutHead[n], span.length - cutTail[n]), tails[n]];
    let t0 = leave[n];
    let t1 = arrive[n];
    if (oneLoop) {
      const r = Math.min(reach, q.length - 1);
      t0 = unit([q[r][0] - q[q.length - 1 - r][0], q[r][1] - q[q.length - 1 - r][1]]);
      t1 = [-t0[0], -t0[1]];
    }
    fitSpan(q, t0, t1, tol, reach, out);
  });
  return out;
}

/** True if a cubic is a straight line within tol, handles included. */
export function isStraight(b: Cubic, tol: number): boolean {
  const cx = b[3][0] - b[0][0];
  const cy = b[3][1] - b[0][1];
  const n = Math.hypot(cx, cy);
  if (n === 0) return false; // a tiny closed loop as one cubic is not a line
  for (const h of [b[1], b[2]]) {
    const dx = h[0] - b[0][0];
    const dy = h[1] - b[0][1];
    if (Math.abs(dx * cy - dy * cx) / n > tol) return false;
    const along = (dx * cx + dy * cy) / (n * n);
    if (along < 0 || along > 1) return false;
  }
  return true;
}

function chainLine(cubics: Cubic[], straightTol: number): Curve {
  const points: Point[] = [];
  for (const b of cubics) {
    if (isStraight(b, straightTol)) points.push(b[0]);
    else for (let i = 0; i < FLAT; i++) points.push(bezierAt(b, i / FLAT));
  }
  points.push(cubics[cubics.length - 1][3]);
  return { points, closed: false };
}

function polylineCubics(p: Point[], closed: boolean, tol: number): Cubic[] {
  const q = closed ? [...p, p[0]] : p;
  let s = simplify(q, tol);
  if (s.length < (closed ? 4 : 2)) s = q;
  const out: Cubic[] = [];
  for (let i = 0; i + 1 < s.length; i++) {
    const a = s[i];
    const b = s[i + 1];
    const dx = (b[0] - a[0]) / 3;
    const dy = (b[1] - a[1]) / 3;
    out.push([a, [a[0] + dx, a[1] + dy], [b[0] - dx, b[1] - dy], b]);
  }
  return out;
}

export interface FitChainsOptions {
  tolMm?: number;
  cornerDeg?: number;
}

/** Fit every chain. Whatever crosses is refitted: tighter, then with corners as traced, then as polylines. */
export function fitChains(chains: Chain[], cellMm: number, o: FitChainsOptions = {}): Cubic[][] {
  // Tighter than the grid only chases the pixel staircase.
  const tolMm = Math.max(o.tolMm ?? 0.02, 1.5 * cellMm);
  const corner = o.cornerDeg ?? 40;
  const k = Math.max(Math.round(0.1 / cellMm), 4);
  const lengths = chains.map((c) => {
    let s = 0;
    for (let i = 1; i < c.points.length; i++) {
      s += Math.hypot(c.points[i][0] - c.points[i - 1][0], c.points[i][1] - c.points[i - 1][1]);
    }
    return s;
  });
  // Short chains stay close to the trace, or a small area could fold over.
  const tols = lengths.map((l) => Math.min(tolMm, l / 60));
  const fits = chains.map((c, i) => fitChain(c.points, c.closed, tols[i], k, corner, cellMm, 3));
  const tries = chains.map(() => 0);
  for (let t = 0; t < 12; t++) {
    const hits = findCrossings(fits.map((f) => chainLine(f, tolMm / 4)));
    if (!hits.length) break;
    for (const n of new Set(hits.flatMap((h) => [h.a, h.b]))) {
      tries[n]++;
      tols[n] = Math.max(tols[n] / 2, cellMm / 8);
      const c = chains[n];
      if (tries[n] > 4) fits[n] = polylineCubics(c.exact, c.closed, cellMm / 4);
      else if (tries[n] > 3) fits[n] = polylineCubics(c.points, c.closed, cellMm / 4);
      else fits[n] = fitChain(c.points, c.closed, tols[n], k, corner, cellMm, tries[n] < 2 ? 3 : 0);
    }
  }
  return fits;
}

function reverseCubics(c: Cubic[]): Cubic[] {
  return c
    .slice()
    .reverse()
    .map((b) => [b[3], b[2], b[1], b[0]]);
}

/** Per label, connected areas with their holes, built from any per-chain payload. */
export function areasOf<T>(
  chains: Chain[],
  forward: (index: number) => T,
  backward: (index: number) => T,
  join: (loop: T[]) => T,
): Map<number, Area<T>[]> {
  const byLabel = new Map<number, StitchEdge<{ item: T; traced: Point[] }>[]>();
  const add = (label: number, edge: StitchEdge<{ item: T; traced: Point[] }>) => {
    const list = byLabel.get(label);
    if (list) list.push(edge);
    else byLabel.set(label, [edge]);
  };
  chains.forEach((c, i) => {
    if (c.left) {
      add(c.left, {
        start: c.start,
        end: c.end,
        firstDir: c.firstDir,
        lastDir: c.lastDir,
        payload: { item: forward(i), traced: c.points },
      });
    }
    if (c.right) {
      add(c.right, {
        start: c.end,
        end: c.start,
        firstDir: [-c.lastDir[0], -c.lastDir[1]],
        lastDir: [-c.firstDir[0], -c.firstDir[1]],
        payload: { item: backward(i), traced: c.points.slice().reverse() },
      });
    }
  });
  const out = new Map<number, Area<T>[]>();
  for (const [label, edges] of byLabel) {
    const loops = stitch(edges).map((parts) => ({
      item: join(parts.map((p) => p.item)),
      traced: parts.flatMap((p) => p.traced),
    }));
    out.set(label, nestLoops(loops));
  }
  return out;
}

/** Fitted areas per label. */
export function cubicAreas(chains: Chain[], fits: Cubic[][]): Map<number, Area<Cubic[]>[]> {
  return areasOf(
    chains,
    (i) => fits[i],
    (i) => reverseCubics(fits[i]),
    (loop) => loop.flat(),
  );
}
