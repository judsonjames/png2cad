/**
 * Scalable SVG for design programs and product printing: filled shapes in real millimeters, one group per color (they
 * open as layers), one path per connected area with its holes cut out. The background is left out, so it stays
 * transparent. Only plain attributes are used, so Affinity, Illustrator and browsers read it the same way.
 */
import { isStraight, type Area, type Cubic, type Point } from "@png2cad/core";

export interface SvgOptions {
  title?: string;
  /** Add a full-size rectangle of this color behind the art. */
  backdrop?: string;
  /** Art size in millimeters. Without it the art keeps its traced size. */
  widthMm?: number;
  heightMm?: number;
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
export function writeSvg(colors: SvgColor[], o: SvgOptions = {}): SvgResult {
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const c of colors) {
    for (const a of c.areas) {
      for (const b of a.outer) {
        for (const p of [b[0], b[3]]) {
          loX = Math.min(loX, p[0]);
          loY = Math.min(loY, p[1]);
          hiX = Math.max(hiX, p[0]);
          hiY = Math.max(hiY, p[1]);
        }
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
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${ws}mm" height="${hs}mm" viewBox="0 0 ${ws} ${hs}">`,
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
