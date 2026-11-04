/**
 * Label boundaries as chains. Every boundary between two labels appears exactly once, running between junctions with
 * exact shared endpoints, so everything built from chains (DXF, SVG, meshes) agrees edge for edge.
 */
import type { LabelMap } from "./grid.ts";

export type Point = [number, number];

export interface Chain {
  /** Dense smoothed points in millimeters, Y up. A closed chain does not repeat its first point. */
  points: Point[];
  /** The same points before smoothing: cell corners, which cannot cross. */
  exact: Point[];
  closed: boolean;
  /** Labels on each side, walking forward. */
  left: number;
  right: number;
  /** Vertex ids at each end, or -1 - chain index for a closed chain. */
  start: number;
  end: number;
  /** First and last step directions, X right and Y up. */
  firstDir: Point;
  lastDir: Point;
}

/** Walk every boundary. Cell corners are vertices; edges lie between cells of different labels. */
export function boundaryChains(map: LabelMap, smooth = 5): Chain[] {
  const { width: w, height: h, cellMm: g } = map;
  const lab = map.data;
  const at = (r: number, c: number) => (r < 0 || c < 0 || r >= h || c >= w ? 0 : lab[r * w + c]);
  const Wv = w + 1;
  const Hv = h + 1;
  // horizontal[v]: an edge runs right from vertex v. vertical[v]: an edge runs down from it.
  const horizontal = new Uint8Array(Wv * Hv);
  const vertical = new Uint8Array(Wv * Hv);
  for (let r = 0; r <= h; r++) {
    for (let c = 0; c <= w; c++) {
      const v = r * Wv + c;
      if (c < w && at(r - 1, c) !== at(r, c)) horizontal[v] = 1;
      if (r < h && at(r, c - 1) !== at(r, c)) vertical[v] = 1;
    }
  }
  const degree = (v: number): number => {
    const c = v % Wv;
    const r = (v - c) / Wv;
    return horizontal[v] + vertical[v] + (c > 0 ? horizontal[v - 1] : 0) + (r > 0 ? vertical[v - Wv] : 0);
  };
  const usedH = new Uint8Array(Wv * Hv);
  const usedV = new Uint8Array(Wv * Hv);

  /** The vertex one step from v in direction d (0 right, 1 down, 2 left, 3 up) if that edge is free, else -1. */
  const step = (v: number, d: number): number => {
    if (d === 0) return horizontal[v] && !usedH[v] ? v + 1 : -1;
    if (d === 1) return vertical[v] && !usedV[v] ? v + Wv : -1;
    if (d === 2) return v % Wv > 0 && horizontal[v - 1] && !usedH[v - 1] ? v - 1 : -1;
    return v >= Wv && vertical[v - Wv] && !usedV[v - Wv] ? v - Wv : -1;
  };
  const use = (v: number, d: number): void => {
    if (d === 0) usedH[v] = 1;
    else if (d === 1) usedV[v] = 1;
    else if (d === 2) usedH[v - 1] = 1;
    else usedV[v - Wv] = 1;
  };

  const walk = (start: number, firstDir: number): number[] => {
    const verts = [start];
    let v = start;
    let d = firstDir;
    for (;;) {
      const next = step(v, d);
      use(v, d);
      v = next;
      verts.push(v);
      if (v === start || degree(v) !== 2) return verts;
      let found = -1;
      for (let k = 0; k < 4; k++) {
        if (step(v, k) >= 0) {
          found = k;
          break;
        }
      }
      if (found < 0) return verts;
      d = found;
    }
  };

  const raw: { verts: number[]; closed: boolean }[] = [];
  for (let v = 0; v < Wv * Hv; v++) {
    if (!horizontal[v] && !vertical[v] && !(v % Wv > 0 && horizontal[v - 1]) && !(v >= Wv && vertical[v - Wv])) {
      continue;
    }
    if (degree(v) === 2) continue;
    for (let d = 0; d < 4; d++) {
      if (step(v, d) >= 0) raw.push({ verts: walk(v, d), closed: false });
    }
  }
  for (let v = 0; v < Wv * Hv; v++) {
    for (const d of [0, 1]) {
      if (step(v, d) >= 0) {
        const verts = walk(v, d);
        verts.pop();
        raw.push({ verts, closed: true });
      }
    }
  }

  return raw.map(({ verts, closed }, index) => {
    const exact: Point[] = verts.map((v) => {
      const c = v % Wv;
      return [c * g, (h - (v - c) / Wv) * g];
    });
    const v0 = verts[0];
    const v1 = verts[1];
    const r0 = (v0 / Wv) | 0;
    const c0 = v0 % Wv;
    const r1 = (v1 / Wv) | 0;
    const c1 = v1 % Wv;
    let left: number;
    let right: number;
    if (c1 > c0) {
      left = at(r0 - 1, c0);
      right = at(r0, c0);
    } else if (c1 < c0) {
      left = at(r0, c1);
      right = at(r0 - 1, c1);
    } else if (r1 > r0) {
      left = at(r0, c0);
      right = at(r0, c0 - 1);
    } else {
      left = at(r1, c0 - 1);
      right = at(r1, c0);
    }
    const n = exact.length;
    const firstDir: Point = [exact[1][0] - exact[0][0], exact[1][1] - exact[0][1]];
    const lastDir: Point = [exact[n - 1][0] - exact[n - 2][0], exact[n - 1][1] - exact[n - 2][1]];
    return {
      points: smoothPoints(exact, closed, smooth),
      exact,
      closed,
      left,
      right,
      start: closed ? -1 - index : verts[0],
      end: closed ? -1 - index : verts[n - 1],
      firstDir,
      lastDir,
    };
  });
}

/** Moving average along a chain. Junction ends stay exact. */
export function smoothPoints(p: Point[], closed: boolean, size: number): Point[] {
  const n = p.length;
  if (n <= size + 1) return p.map((q) => [q[0], q[1]]);
  const half = size >> 1;
  const out: Point[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let k = -half; k <= half; k++) {
      const j = closed ? (i + k + n) % n : Math.min(Math.max(i + k, 0), n - 1);
      x += p[j][0];
      y += p[j][1];
    }
    out[i] = [x / size, y / size];
  }
  if (!closed) {
    out[0] = [p[0][0], p[0][1]];
    out[n - 1] = [p[n - 1][0], p[n - 1][1]];
  }
  return out;
}

/** Douglas-Peucker. Keeps both ends. */
export function simplify(p: Point[], tol: number): Point[] {
  const n = p.length;
  if (n < 3) return p.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    const ax = p[a][0];
    const ay = p[a][1];
    const dx = p[b][0] - ax;
    const dy = p[b][1] - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const e = len
        ? Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / len
        : Math.hypot(p[i][0] - ax, p[i][1] - ay);
      if (e > worst) {
        worst = e;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push(a, at, at, b);
    }
  }
  const out: Point[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i]);
  return out;
}

export interface Curve {
  points: Point[];
  closed: boolean;
}

export interface Hit {
  a: number;
  b: number;
  x: number;
  y: number;
}

/** Segments that touch or cross. Segments sharing an endpoint are allowed, as at a junction. */
export function findCrossings(curves: Curve[], eps = 1e-7, limit = Infinity): Hit[] {
  const x0: number[] = [];
  const y0: number[] = [];
  const x1: number[] = [];
  const y1: number[] = [];
  const owner: number[] = [];
  curves.forEach((c, ci) => {
    const n = c.points.length;
    const count = c.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = c.points[i];
      const b = c.points[(i + 1) % n];
      x0.push(a[0]);
      y0.push(a[1]);
      x1.push(b[0]);
      y1.push(b[1]);
      owner.push(ci);
    }
  });
  const m = owner.length;
  const order = Array.from({ length: m }, (_, i) => i).sort((i, j) => Math.min(x0[i], x1[i]) - Math.min(x0[j], x1[j]));
  const orient = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const near = (ax: number, ay: number, bx: number, by: number) => Math.abs(ax - bx) + Math.abs(ay - by) < eps;
  const hits: Hit[] = [];
  for (let n = 0; n < m; n++) {
    const i = order[n];
    const hiX = Math.max(x0[i], x1[i]);
    const loY = Math.min(y0[i], y1[i]);
    const hiY = Math.max(y0[i], y1[i]);
    for (let k = n + 1; k < m; k++) {
      const j = order[k];
      if (Math.min(x0[j], x1[j]) > hiX) break;
      if (Math.min(y0[j], y1[j]) > hiY || Math.max(y0[j], y1[j]) < loY) continue;
      if (
        near(x0[i], y0[i], x0[j], y0[j]) ||
        near(x0[i], y0[i], x1[j], y1[j]) ||
        near(x1[i], y1[i], x0[j], y0[j]) ||
        near(x1[i], y1[i], x1[j], y1[j])
      ) {
        continue;
      }
      if (
        orient(x0[j], y0[j], x1[j], y1[j], x0[i], y0[i]) * orient(x0[j], y0[j], x1[j], y1[j], x1[i], y1[i]) <= 0 &&
        orient(x0[i], y0[i], x1[i], y1[i], x0[j], y0[j]) * orient(x0[i], y0[i], x1[i], y1[i], x1[j], y1[j]) <= 0
      ) {
        hits.push({ a: owner[i], b: owner[j], x: x0[i], y: y0[i] });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}

/**
 * Chains as simplified polylines, for DXF and meshes. Anything that crosses is simplified again more tightly, and in
 * the end falls back on the cell edges, which cannot cross.
 */
export function chainsToCurves(chains: Chain[], tolMm: number, cellMm: number): Curve[] {
  const simplifyChain = (c: Chain, tol: number, source: Point[]): Point[] => {
    if (!c.closed) return simplify(source, tol);
    const s = simplify([...source, source[0]], tol);
    s.pop();
    return s.length >= 3 ? s : source;
  };
  const tols = chains.map(() => tolMm);
  const curves: Curve[] = chains.map((c, i) => ({ points: simplifyChain(c, tols[i], c.points), closed: c.closed }));
  for (let t = 0; t < 8; t++) {
    const hits = findCrossings(curves);
    if (!hits.length) break;
    for (const i of new Set(hits.flatMap((h) => [h.a, h.b]))) {
      tols[i] /= 2;
      const c = chains[i];
      curves[i] = {
        points: tols[i] > cellMm / 8 ? simplifyChain(c, tols[i], c.points) : simplifyChain(c, cellMm / 8, c.exact),
        closed: c.closed,
      };
    }
  }
  return curves;
}

function turn(incoming: Point, outgoing: Point): number {
  return -Math.atan2(
    incoming[0] * outgoing[1] - incoming[1] * outgoing[0],
    incoming[0] * outgoing[0] + incoming[1] * outgoing[1],
  );
}

export interface StitchEdge<T> {
  start: number;
  end: number;
  firstDir: Point;
  lastDir: Point;
  /** What this edge carries: curve segments, points and so on. */
  payload: T;
}

/**
 * Join directed edges, the color on their left, into closed loops. At a pinch point, where a color touches itself at a
 * corner, a loop takes the sharpest left turn and closes when that turn leads back to its start.
 */
export function stitch<T>(edges: StitchEdge<T>[]): T[][] {
  const outAt = new Map<number, number[]>();
  edges.forEach((e, i) => {
    const list = outAt.get(e.start);
    if (list) list.push(i);
    else outAt.set(e.start, [i]);
  });
  const used = new Uint8Array(edges.length);
  const loops: T[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop: T[] = [];
    let cur = i;
    for (;;) {
      used[cur] = 1;
      loop.push(edges[cur].payload);
      const here = edges[cur];
      const options = (outAt.get(here.end) ?? []).filter((j) => !used[j] || j === i);
      if (!options.length) break;
      let next = options[0];
      let best = Infinity;
      for (const j of options) {
        const k = turn(here.lastDir, edges[j].firstDir);
        if (k < best) {
          best = k;
          next = j;
        }
      }
      if (next === i) break;
      cur = next;
    }
    loops.push(loop);
  }
  return loops;
}

export function signedArea(q: Point[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const r = q[(i + 1) % q.length];
    a += p[0] * r[1] - p[1] * r[0];
  }
  return a / 2;
}

function inside(pt: Point, q: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    if (q[i][1] > pt[1] !== q[j][1] > pt[1]) {
      const x = q[i][0] + ((pt[1] - q[i][1]) * (q[j][0] - q[i][0])) / (q[j][1] - q[i][1]);
      if (x > pt[0]) hit = !hit;
    }
  }
  return hit;
}

export interface Area<T> {
  outer: T;
  holes: T[];
}

/**
 * Group loops into areas. A color on the left makes outlines run counterclockwise. Direction and nesting come from
 * traced points, which a loose curve fit cannot turn inside out.
 */
export function nestLoops<T>(loops: { item: T; traced: Point[] }[]): Area<T>[] {
  const area = loops.map((l) => signedArea(l.traced));
  const outers = loops.map((_, i) => i).filter((i) => area[i] > 0);
  outers.sort((a, b) => area[a] - area[b]);
  const groups = new Map<number, number[]>(outers.map((i) => [i, []]));
  const holds = (o: number, q: Point[]): boolean => {
    // Three points, as one may sit on a shared pinch.
    let n = 0;
    for (const j of [0, Math.floor(q.length / 3), Math.floor((2 * q.length) / 3)]) {
      if (inside(q[j], loops[o].traced)) n++;
    }
    return n >= 2;
  };
  loops.forEach((l, i) => {
    if (area[i] > 0) return;
    const home = outers.find((o) => area[o] > -area[i] && holds(o, l.traced));
    if (home === undefined) groups.set(i, []);
    else groups.get(home)?.push(i);
  });
  return [...groups.entries()].map(([o, holes]) => ({ outer: loops[o].item, holes: holes.map((i) => loops[i].item) }));
}
