/**
 * Independent checks. Each verifier reads the finished file back from its bytes and shares no code with the writer, so
 * a writer bug cannot hide itself. Problems are findings; nothing is fixed silently.
 */
import { findCrossings, type Curve, type Point } from "@png2cad/core";
import { unzipSync } from "fflate";

export type Severity = "pass" | "warning" | "fault";

export interface Finding {
  severity: Severity;
  code: string;
  message: string;
}

const pass = (code: string, message: string): Finding => ({ severity: "pass", code, message });
const fault = (code: string, message: string): Finding => ({ severity: "fault", code, message });

/** The art must fill the requested box on at least one side and pass it on neither. */
function sizeFinding(
  code: string,
  name: string,
  width: number,
  height: number,
  unit: string,
  maxWidth?: number,
  maxHeight?: number,
): Finding {
  const shown = `${Number(width.toFixed(3))} x ${Number(height.toFixed(3))}${unit}`;
  if ((maxWidth && width > maxWidth * 1.002) || (maxHeight && height > maxHeight * 1.002)) {
    return fault(`${code}.size`, `The ${name} is ${shown}, larger than the requested size.`);
  }
  const filled = (maxWidth && width >= maxWidth * 0.995) || (maxHeight && height >= maxHeight * 0.995);
  if ((maxWidth || maxHeight) && !filled) {
    return fault(`${code}.size`, `The ${name} is ${shown}, smaller than the requested size.`);
  }
  return pass(`${code}.size`, `Size is ${shown}`);
}

export function readDxf(text: string): Curve[] {
  const lines = text.split("\n").map((s) => s.trim());
  const curves: Curve[] = [];
  let cur: Point[] | null = null;
  let inHeader = true;
  let closed = false;
  let x = 0;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i];
    const val = lines[i + 1];
    if (code === "0" && val === "POLYLINE") {
      cur = [];
      inHeader = true;
      closed = false;
    } else if (code === "70" && cur && inHeader) {
      closed = (Number(val) & 1) === 1;
    } else if (code === "0" && val === "VERTEX") {
      inHeader = false;
    } else if (code === "0" && val === "SEQEND" && cur) {
      curves.push({ points: cur, closed });
      cur = null;
    } else if (cur && !inHeader && code === "10") {
      x = Number(val);
    } else if (cur && !inHeader && code === "20") {
      cur.push([x, Number(val)]);
    }
  }
  return curves;
}

/** Crossings, loose ends and extents. Lengths are in the file's own units. */
export function verifyDxf(text: string, maxWidth?: number, maxHeight?: number): Finding[] {
  const out: Finding[] = [];
  const curves = readDxf(text);
  if (!curves.length) return [fault("dxf.empty", "The DXF holds no curves.")];
  const hits = findCrossings(curves, 1e-9, 20);
  out.push(
    hits.length
      ? fault("dxf.crossing", `${hits.length} crossing edges. Onshape cannot form regions there.`)
      : pass("dxf.crossing", "No crossing edges"),
  );
  const ends = new Map<string, number>();
  for (const c of curves) {
    if (c.closed) continue;
    for (const p of [c.points[0], c.points[c.points.length - 1]]) {
      const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
      ends.set(key, (ends.get(key) ?? 0) + 1);
    }
  }
  const loose = [...ends.values()].filter((n) => n < 2).length;
  out.push(loose ? fault("dxf.loose", `${loose} loose curve ends.`) : pass("dxf.loose", "No loose ends"));
  let hiX = -Infinity;
  let hiY = -Infinity;
  let loX = Infinity;
  let loY = Infinity;
  for (const c of curves) {
    for (const p of c.points) {
      hiX = Math.max(hiX, p[0]);
      hiY = Math.max(hiY, p[1]);
      loX = Math.min(loX, p[0]);
      loY = Math.min(loY, p[1]);
    }
  }
  out.push(sizeFinding("dxf", "DXF", hiX - loX, hiY - loY, "", maxWidth, maxHeight));
  return out;
}

interface SvgPath {
  group: string;
  subpaths: { points: Point[]; closed: boolean }[];
}

const flatten = (p0: Point, p1: Point, p2: Point, p3: Point, into: Point[]): void => {
  for (let i = 0; i < 12; i++) {
    const u = i / 12;
    const v = 1 - u;
    into.push([
      v * v * v * p0[0] + 3 * u * v * v * p1[0] + 3 * u * u * v * p2[0] + u * u * u * p3[0],
      v * v * v * p0[1] + 3 * u * v * v * p1[1] + 3 * u * u * v * p2[1] + u * u * u * p3[1],
    ]);
  }
};

function parsePath(d: string): SvgPath["subpaths"] {
  const tokens = d.match(/[MCLZ]|-?\d*\.?\d+/g) ?? [];
  const subs: SvgPath["subpaths"] = [];
  let points: Point[] = [];
  let pos: Point = [0, 0];
  let start: Point = [0, 0];
  let closed = false;
  let i = 0;
  const flush = () => {
    if (points.length) subs.push({ points, closed });
    points = [];
    closed = false;
  };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (cmd === "M") {
      flush();
      pos = [n(), n()];
      start = pos;
    } else if (cmd === "L") {
      points.push(pos);
      pos = [n(), n()];
    } else if (cmd === "C") {
      const a: Point = [n(), n()];
      const b: Point = [n(), n()];
      const c: Point = [n(), n()];
      flatten(pos, a, b, c, points);
      pos = c;
    } else if (cmd === "Z") {
      closed = Math.abs(pos[0] - start[0]) + Math.abs(pos[1] - start[1]) < 1e-6;
      flush();
    } else {
      throw new Error(`Unexpected path token ${cmd}`);
    }
  }
  flush();
  return subs;
}

/** Structure, closed paths, size and crossings. Sizes in millimeters. */
export function verifySvg(text: string, maxWidth?: number, maxHeight?: number): Finding[] {
  const out: Finding[] = [];
  const size = /<svg[^>]*\swidth="([\d.]+)mm"[^>]*\sheight="([\d.]+)mm"[^>]*\sviewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(
    text,
  );
  if (!size) out.push(fault("svg.size", "The SVG does not state its size in millimeters."));
  else if (Math.abs(Number(size[1]) - Number(size[3])) > 1e-3 || Math.abs(Number(size[2]) - Number(size[4])) > 1e-3) {
    out.push(fault("svg.viewbox", "The viewBox does not match the size."));
  } else {
    out.push(sizeFinding("svg", "SVG", Number(size[1]), Number(size[2]), " mm", maxWidth, maxHeight));
  }
  if (/<(image|text|style|use|defs)\b|\s(stroke|style|transform|class)=/.test(text)) {
    out.push(fault("svg.plain", "The SVG holds something other than filled paths."));
  } else {
    out.push(pass("svg.plain", "Filled paths only"));
  }
  const groups = [...text.matchAll(/<g id="([^"]+)" fill="(#[0-9a-f]{6})" fill-rule="evenodd">([\s\S]*?)<\/g>/g)];
  if (!groups.length) return [...out, fault("svg.empty", "The SVG holds no colors.")];
  const curves: Curve[] = [];
  const seen = new Set<string>();
  let open = 0;
  for (const g of groups) {
    for (const m of g[3].matchAll(/<path d="([^"]+)"/g)) {
      for (const sub of parsePath(m[1])) {
        if (!sub.closed) open++;
        const pts = sub.points;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const ka = `${a[0].toFixed(6)},${a[1].toFixed(6)}`;
          const kb = `${b[0].toFixed(6)},${b[1].toFixed(6)}`;
          if (ka === kb) continue;
          const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          if (seen.has(key)) continue;
          seen.add(key);
          curves.push({ points: [a, b], closed: false });
        }
      }
    }
  }
  out.push(open ? fault("svg.open", `${open} open paths.`) : pass("svg.open", "All paths closed"));
  // A crossing means lines that pass 0.001 mm beyond each other; anything shallower is rounding at a shared point.
  const deep = findCrossings(curves, 1e-9).filter((h) => {
    const s = curves[h.a].points;
    const t = curves[h.b].points;
    const reach = (a: Point[], b: Point[]) =>
      b.map((p) => {
        const dx = a[1][0] - a[0][0];
        const dy = a[1][1] - a[0][1];
        const n = Math.hypot(dx, dy);
        return n ? Math.abs((p[0] - a[0][0]) * dy - (p[1] - a[0][1]) * dx) / n : 0;
      });
    return Math.min(...reach(s, t), ...reach(t, s)) > 0.001;
  });
  out.push(
    deep.length ? fault("svg.crossing", `${deep.length} crossing edges.`) : pass("svg.crossing", "No crossing edges"),
  );
  return out;
}

export interface MeshReport {
  name: string;
  triangles: number;
  volumeMm3: number;
  openEdges: number;
  /** Flat triangles facing the wrong way on a shell's top or bottom. Their overlap hides in area and volume totals. */
  folded: number;
  filament: number | null;
}

/**
 * Folded triangles: in each shell, every flat face on its top level must face up and every flat face on its bottom
 * level must face down.
 */
function countFolded(v: number[], t: number[]): number {
  const parent = Int32Array.from({ length: v.length / 3 }, (_, i) => i);
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== r) [parent[a], a] = [r, parent[a]];
    return r;
  };
  for (let i = 0; i < t.length; i += 3) {
    parent[find(t[i + 1])] = find(t[i]);
    parent[find(t[i + 2])] = find(t[i]);
  }
  const top = new Map<number, number>();
  const bottom = new Map<number, number>();
  for (let i = 0; i < parent.length; i++) {
    const r = find(i);
    const z = v[i * 3 + 2];
    top.set(r, Math.max(top.get(r) ?? -Infinity, z));
    bottom.set(r, Math.min(bottom.get(r) ?? Infinity, z));
  }
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8 + 1e-5 * Math.abs(b);
  let folded = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    if (!close(v[a + 2], v[b + 2]) || !close(v[b + 2], v[c + 2])) continue;
    const nz = (v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[b + 1] - v[a + 1]) * (v[c] - v[a]);
    if (Math.abs(nz) < 1e-12) continue;
    const r = find(t[i]);
    if ((close(v[a + 2], top.get(r) as number) && nz < 0) || (close(v[a + 2], bottom.get(r) as number) && nz > 0)) {
      folded++;
    }
  }
  return folded;
}

/** Read a 3MF back: watertight parts, positive volume, one filament per part. */
export function verifyThreeMf(bytes: Uint8Array, materials?: number): { findings: Finding[]; parts: MeshReport[] } {
  const findings: Finding[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { findings: [fault("3mf.zip", "The 3MF is not a readable package.")], parts: [] };
  }
  for (const need of ["[Content_Types].xml", "_rels/.rels", "3D/3dmodel.model"]) {
    if (!files[need]) findings.push(fault("3mf.package", `The package is missing ${need}.`));
  }
  if (findings.length) return { findings, parts: [] };
  const dec = new TextDecoder();
  const model = dec.decode(files["3D/3dmodel.model"]);
  if (!/<model unit="millimeter"/.test(model)) findings.push(fault("3mf.unit", "The model is not in millimeters."));
  const config = files["Metadata/model_settings.config"] ? dec.decode(files["Metadata/model_settings.config"]) : "";
  const filaments = new Map<string, number>();
  for (const m of config.matchAll(/<part id="(\d+)"[^>]*>[\s\S]*?key="extruder" value="(\d+)"/g)) {
    filaments.set(m[1], Number(m[2]));
  }
  const parts: MeshReport[] = [];
  for (const m of model.matchAll(/<object id="(\d+)"[^>]*name="([^"]*)"[^>]*>\s*<mesh>([\s\S]*?)<\/mesh>/g)) {
    const body = m[3];
    const v: number[] = [];
    for (const q of body.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)) {
      v.push(Number(q[1]), Number(q[2]), Number(q[3]));
    }
    const edges = new Map<number, number>();
    const count = v.length / 3;
    const tris: number[] = [];
    let volume = 0;
    let triangles = 0;
    for (const q of body.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)) {
      const a = Number(q[1]);
      const b = Number(q[2]);
      const c = Number(q[3]);
      triangles++;
      tris.push(a, b, c);
      for (const [s, t] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const key = s * count + t;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      const ax = v[a * 3];
      const ay = v[a * 3 + 1];
      const az = v[a * 3 + 2];
      const bx = v[b * 3];
      const by = v[b * 3 + 1];
      const bz = v[b * 3 + 2];
      const cx = v[c * 3];
      const cy = v[c * 3 + 1];
      const cz = v[c * 3 + 2];
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    let open = 0;
    for (const [key, n] of edges) {
      const s = Math.floor(key / count);
      const t = key - s * count;
      if (n !== 1 || edges.get(t * count + s) !== 1) open++;
    }
    parts.push({
      name: m[2],
      triangles,
      volumeMm3: volume,
      openEdges: open,
      folded: countFolded(v, tris),
      filament: filaments.get(m[1]) ?? null,
    });
  }
  if (!parts.length) return { findings: [...findings, fault("3mf.empty", "The 3MF holds no meshes.")], parts };
  const leaky = parts.filter((p) => p.openEdges || p.folded || p.volumeMm3 <= 0);
  findings.push(
    leaky.length
      ? fault("3mf.watertight", `Not watertight: ${leaky.map((p) => p.name).join(", ")}.`)
      : pass("3mf.watertight", `${parts.length} watertight parts`),
  );
  const assigned = parts.map((p) => p.filament).sort((a, b) => (a ?? 0) - (b ?? 0));
  const inOrder = assigned.every((f, i) => f === i + 1);
  findings.push(
    inOrder
      ? pass("3mf.filaments", `Filaments 1 to ${parts.length} assigned`)
      : fault("3mf.filaments", "Filaments are not assigned 1 to N, one per part."),
  );
  if (materials && parts.length !== materials) {
    findings.push(fault("3mf.materials", `The plate has ${parts.length} materials, not ${materials}.`));
  }
  return { findings, parts };
}
