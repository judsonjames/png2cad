/**
 * Scalable SVG for design programs and product printing: filled shapes in real millimeters, one group per color (they
 * open as layers), one path per connected area with its holes cut out. The background is left out, so it stays
 * transparent. Only plain attributes are used, so Affinity, Illustrator and browsers read it the same way.
 */
import { MM_PER_INCH, isStraight, type Area, type Cubic, type Point } from "@png2cad/core";

export interface SvgOptions {
  title?: string;
  /** Add a full-size rectangle of this color behind the art. */
  backdrop?: string;
  /** Art size in millimeters. Without it the art keeps its traced size. */
  widthMm?: number;
  heightMm?: number;
  /** The unit the file states its size in, so a design program opens it that way. Coordinates stay in millimeters. */
  units?: "mm" | "in";
  straightTolMm?: number;
}

export interface SvgColor {
  name: string;
  color: [number, number, number];
  areas: Area<Cubic[]>[];
}

export interface SvgResult {
  text: string;
  widthMm: number;
  heightMm: number;
  paths: number;
  nodes: number;
}

function num(x: number): string {
  const s = x.toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" || s === "" ? "0" : s;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeId(name: string, taken: Set<string>): string {
  const clean = name.replace(/[^A-Za-z0-9_-]/g, "-") || "color";
  const base = /^[A-Za-z]/.test(clean) ? clean : `c-${clean}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function hexColor(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** Colors and their areas to SVG text. Art fills the box exactly, without distortion. */
/**
 * How far a curve reaches along one axis: its ends and wherever it turns back. A curve can bulge past both its end
 * points, so sizing the page from end points alone cut the sides off a circle.
 */
function reach(b: Cubic, axis: 0 | 1): number[] {
  const [p0, p1, p2, p3] = [b[0][axis], b[1][axis], b[2][axis], b[3][axis]];
  const first = p1 - p0;
  const half = p2 - p1 - first;
  const a = p3 - p2 - 2 * (p2 - p1) + first;
  const turns: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(half) > 1e-12) turns.push(-first / (2 * half));
  } else if (half * half >= a * first) {
    const root = Math.sqrt(half * half - a * first);
    turns.push((-half + root) / a, (-half - root) / a);
  }
  const at = (t: number) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  };
  return [p0, p3, ...turns.filter((t) => t > 0 && t < 1).map(at)];
}

export function writeSvg(colors: SvgColor[], o: SvgOptions = {}): SvgResult {
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const c of colors) {
    for (const a of c.areas) {
      for (const b of a.outer) {
        const xs = reach(b, 0);
        const ys = reach(b, 1);
        loX = Math.min(loX, ...xs);
        hiX = Math.max(hiX, ...xs);
        loY = Math.min(loY, ...ys);
        hiY = Math.max(hiY, ...ys);
      }
    }
  }
  const fits: number[] = [];
  if (o.widthMm) fits.push(o.widthMm / (hiX - loX));
  if (o.heightMm) fits.push(o.heightMm / (hiY - loY));
  const k = fits.length ? Math.min(...fits) : 1;
  const w = (hiX - loX) * k;
  const h = (hiY - loY) * k;
  const map = (p: Point): Point => [(p[0] - loX) * k, h - (p[1] - loY) * k];
  const tol = o.straightTolMm ?? 0.005;

  const loopData = (loop: Cubic[]): string => {
    const start = map(loop[0][0]);
    const out = [`M${num(start[0])} ${num(start[1])}`];
    for (const b of loop) {
      const s: Cubic = [map(b[0]), map(b[1]), map(b[2]), map(b[3])];
      if (isStraight(s, tol)) out.push(`L${num(s[3][0])} ${num(s[3][1])}`);
      else out.push(`C${[s[1], s[2], s[3]].map((p) => `${num(p[0])} ${num(p[1])}`).join(" ")}`);
    }
    return `${out.join("")}Z`;
  };

  const ws = num(w);
  const hs = num(h);
  const stated = (mm: number) => (o.units === "in" ? `${Number((mm / MM_PER_INCH).toFixed(5))}in` : `${num(mm)}mm`);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${stated(w)}" height="${stated(h)}" viewBox="0 0 ${ws} ${hs}">`,
    `  <title>${escapeXml(o.title ?? "artwork")}</title>`,
  ];
  if (o.backdrop) lines.push(`  <rect id="backdrop" width="${ws}" height="${hs}" fill="${escapeXml(o.backdrop)}"/>`);
  const taken = new Set(["backdrop"]);
  let paths = 0;
  let nodes = 0;
  for (const c of colors) {
    lines.push(`  <g id="${safeId(c.name, taken)}" fill="${hexColor(c.color)}" fill-rule="evenodd">`);
    for (const a of c.areas) {
      lines.push(`    <path d="${[a.outer, ...a.holes].map(loopData).join("")}"/>`);
      paths++;
      nodes += a.outer.length + a.holes.reduce((n, hole) => n + hole.length, 0);
    }
    lines.push("  </g>");
  }
  lines.push("</svg>");
  return { text: `${lines.join("\n")}\n`, widthMm: w, heightMm: h, paths, nodes };
}
