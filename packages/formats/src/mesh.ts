/**
 * 3MF plates from boundary loops. manifold-3d does the booleans, triangulation and extrusion, so every part comes out
 * closed and consistently oriented. WASM objects are not garbage collected, so all of them go through `scope`.
 */
import { MM_PER_INCH, areasOf, chainsToCurves, signedArea, type Chain, type LabelMap, type Point } from "@png2cad/core";
import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";

export type PlateStyle = "inset" | "relief" | "flat";

/**
 * Meshes leave the kernel as 32-bit floats, spaced 0.000008 mm apart at 100 mm. A triangle thinner than that can flip
 * over when rounded, which leaves a fold in a closed part. Well under the trace grid, and above the spacing at any size
 * a printer can make.
 */
const SLIVER_MM = 1e-4;

export interface PlateOptions {
  style?: PlateStyle;
  baseMm?: number;
  reliefMm?: number;
  /** Depth of the inlaid design. */
  insetMm?: number;
  baseShape?: "auto" | "rect" | "footprint";
  marginMm?: number;
  baseColor?: [number, number, number];
  /** Label that forms the plate in multi-color inset art. Defaults to the color along the outer edge. */
  body?: number;
  tolMm?: number;
}

export interface Part {
  name: string;
  color: [number, number, number];
  vertices: Float32Array;
  triangles: Uint32Array;
}

/** The color that runs along most of the art's outer edge: the natural body color. */
export function outerEdgeLabel(map: LabelMap): number {
  const { data, width: w, height: h } = map;
  const votes = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      if (!v) continue;
      const edge =
        x === 0 ||
        y === 0 ||
        x === w - 1 ||
        y === h - 1 ||
        !data[y * w + x - 1] ||
        !data[y * w + x + 1] ||
        !data[(y - 1) * w + x] ||
        !data[(y + 1) * w + x];
      if (edge) votes.set(v, (votes.get(v) ?? 0) + 1);
    }
  }
  let best = 0;
  let most = -1;
  for (const [v, n] of votes) {
    if (n > most) {
      most = n;
      best = v;
    }
  }
  return best;
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

/** Closed polygons per label, all sharing the same simplified edges. */
export function labelLoops(chains: Chain[], cellMm: number, tolMm: number): Map<number, Point[][]> {
  const curves = chainsToCurves(chains, tolMm, cellMm);
  const areas = areasOf<Point[]>(
    chains,
    (i) => curves[i].points,
    (i) => curves[i].points.slice().reverse(),
    (loop) => dedupe(loop.flat()),
  );
  const out = new Map<number, Point[][]>();
  // A tiny area can simplify down to a line. It has no area to lose, and one such loop would make the kernel reject
  // every other loop of that color.
  for (const [label, list] of areas) {
    const kept = list
      .flatMap((a) => [a.outer, ...a.holes])
      .filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 1e-9);
    if (kept.length) out.set(label, kept);
  }
  return out;
}

export function buildParts(wasm: ManifoldToplevel, map: LabelMap, chains: Chain[], o: PlateOptions = {}): Part[] {
  const style = o.style ?? "inset";
  const baseMm = o.baseMm ?? 1.2;
  const reliefMm = o.reliefMm ?? 0.6;
  const insetMm = o.insetMm ?? 2;
  const marginMm = o.marginMm ?? 2;
  const baseColor = o.baseColor ?? [160, 160, 160];
  const tolMm = o.tolMm ?? 0.0127;
  const { CrossSection: Section, Manifold: Solid } = wasm;

  const loops = labelLoops(chains, map.cellMm, tolMm);
  const labels = [...loops.keys()].sort((a, b) => a - b);
  if (!labels.length) throw new Error("The artwork has no areas to make a plate from.");
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const ls of loops.values()) {
    for (const l of ls) {
      for (const p of l) {
        loX = Math.min(loX, p[0]);
        loY = Math.min(loY, p[1]);
        hiX = Math.max(hiX, p[0]);
        hiY = Math.max(hiY, p[1]);
      }
    }
  }

  const held: { delete(): void }[] = [];
  const scope = <T extends { delete(): void }>(x: T): T => {
    held.push(x);
    return x;
  };
  try {
    const sections = new Map<number, CrossSection>();
    for (const v of labels) {
      const polys = (loops.get(v) as Point[][]).map((l) => l.map(([x, y]) => [x - loX, y - loY] as [number, number]));
      sections.set(v, scope(new Section(polys, "EvenOdd")));
    }
    const footprint = () => scope(Section.union(labels.map((v) => sections.get(v) as CrossSection)));
    const shape = (o.baseShape ?? "auto") === "auto" ? (labels.length === 1 ? "rect" : "footprint") : o.baseShape;
    const plate = () => {
      const w = hiX - loX;
      const h = hiY - loY;
      const m = marginMm;
      return scope(
        new Section(
          [
            [
              [-m, -m],
              [w + m, -m],
              [w + m, h + m],
              [-m, h + m],
            ],
          ],
          "EvenOdd",
        ),
      );
    };
    const prism = (s: CrossSection, z0: number, z1: number): Manifold =>
      scope(scope(s.extrude(z1 - z0)).translate([0, 0, z0]));
    const parts: Part[] = [];
    const add = (name: string, color: [number, number, number], raw: Manifold) => {
      const solid = scope(raw.simplify(SLIVER_MM));
      // Never a silent gap in the plate: a part that comes out empty stops the job.
      if (solid.isEmpty()) throw new Error(`The ${name} part of the plate came out empty (${solid.status()}).`);
      const mesh = solid.getMesh();
      const n = mesh.vertProperties.length / mesh.numProp;
      const vertices = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        vertices[i * 3] = mesh.vertProperties[i * mesh.numProp];
        vertices[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
        vertices[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
      }
      parts.push({ name, color, vertices, triangles: mesh.triVerts.slice() });
    };

    if (style === "flat") {
      for (const v of labels)
        add(map.names[v], map.colors[v], prism(sections.get(v) as CrossSection, 0, baseMm + reliefMm));
      return parts;
    }
    if (style === "relief") {
      add("base", baseColor, prism(shape === "rect" ? plate() : footprint(), 0, baseMm));
      for (const v of labels) {
        add(map.names[v], map.colors[v], prism(sections.get(v) as CrossSection, baseMm, baseMm + reliefMm));
      }
      return parts;
    }
    // Inset: the body is a slab under everything plus its own areas in the top layer; the rest is inlaid flush.
    const top0 = baseMm;
    const top1 = baseMm + insetMm;
    let inlaid = labels;
    if (shape === "rect") {
      const rect = plate();
      const art = footprint();
      const rest = scope(rect.subtract(art));
      add("base", baseColor, scope(Solid.union(prism(rect, 0, top0), prism(rest, top0, top1))));
    } else {
      const b = o.body && labels.includes(o.body) ? o.body : outerEdgeLabel(map);
      const slab = prism(footprint(), 0, top0);
      add(map.names[b], map.colors[b], scope(Solid.union(slab, prism(sections.get(b) as CrossSection, top0, top1))));
      inlaid = labels.filter((v) => v !== b);
    }
    for (const v of inlaid) add(map.names[v], map.colors[v], prism(sections.get(v) as CrossSection, top0, top1));
    return parts;
  } finally {
    for (const x of held.reverse()) x.delete();
  }
}

export function partBounds(parts: Part[]) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < p.vertices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p.vertices[i + k]);
        hi[k] = Math.max(hi[k], p.vertices[i + k]);
      }
    }
  }
  return { lo, hi };
}

export const inchesOf = (mm: number): number => mm / MM_PER_INCH;
