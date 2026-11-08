/**
 * One conversion, end to end, in a form the web worker and the CLI share: a label map and a request go in, named files
 * and findings come out. The same input gives the same bytes.
 */
import {
  boundaryChains,
  chainsToCurves,
  cubicAreas,
  fitChains,
  fitToNozzle,
  layerHeights,
  MM_PER_INCH,
  type Curve,
  type FitOptions,
  type FitReport,
  type LabelMap,
  type Point,
  type FitProgress,
} from "@png2cad/core";
import { writeDxf, type DxfUnits } from "./dxf.ts";
import { buildParts, labelLoops, partBounds, type Part, type PlateOptions } from "./mesh.ts";
import { hexColor, writeSvg, type SvgColor, type SvgResult } from "./svg.ts";
import { projectFromTemplate, writeThreeMf, type BambuTemplate } from "./threemf.ts";
import { verifyDxf, verifySvg, verifyThreeMf, type Finding } from "./verify.ts";
import type { ManifoldToplevel } from "manifold-3d";

export interface OutputFile {
  name: string;
  /** What kind of file this is, for the file list. */
  kind: "svg" | "dxf" | "3mf";
  bytes: Uint8Array;
  nozzleMm: number | null;
  /** The size inside the file, in the file's own units, as a person would read it. */
  sizeText: string;
}

export interface SvgRequest {
  /**
   * art comes from the unfitted map, for design programs; nozzle has the fitted line widths; line holds every line to
   * lineMm, for printing that has its own smallest line.
   */
  source: "art" | "nozzle" | "line";
  lineMm?: number;
  /** The unit the file states its size in. */
  units?: DxfUnits;
  backdrop?: string;
  tolMm?: number;
}

/**
 * Fit for a smallest line. Gaps get half the width: a gap as wide as the line closes the spaces in small lettering, and
 * ink or a design program does not need the room a nozzle does.
 */
export const LINE_FIT = { featureFactor: 1, gapFactor: 0.5 };

export interface JobRequest {
  title: string;
  widthMm?: number;
  heightMm?: number;
  nozzles: number[];
  fit?: Omit<FitOptions, "nozzleMm">;
  svg?: SvgRequest;
  dxf?: { units: DxfUnits; perColor: boolean };
  plate?: PlateOptions & {
    layerMm?: number;
    insetLayers?: number;
    insetMm?: number;
    materials?: number;
    template?: BambuTemplate;
  };
}

export interface NozzleResult {
  report: FitReport;
  map: LabelMap;
  parts?: Part[];
}

export interface JobResult {
  files: OutputFile[];
  findings: Finding[];
  nozzles: NozzleResult[];
  svg?: SvgResult;
}

export type Progress = (message: string, done: number) => void;

const EDGE_TOL_MM = 0.0127;
const enc = new TextEncoder();
const dec = new TextDecoder();

function svgColors(map: LabelMap, tolMm?: number): SvgColor[] {
  const chains = boundaryChains(map);
  const areas = cubicAreas(chains, fitChains(chains, map.cellMm, { tolMm }));
  return [...areas.keys()]
    .sort((a, b) => a - b)
    .map((v) => ({ name: map.names[v], color: map.colors[v], areas: areas.get(v) ?? [] }));
}

/** The vector result for a map, for previews and the art SVG. */
export function vectorize(
  map: LabelMap,
  title: string,
  box: { widthMm?: number; heightMm?: number },
  svg: SvgRequest | undefined,
) {
  return writeSvg(svgColors(map, svg?.tolMm), { title, backdrop: svg?.backdrop, units: svg?.units, ...box });
}

function extents(lists: Point[][]) {
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const points of lists) {
    for (const p of points) {
      loX = Math.min(loX, p[0]);
      loY = Math.min(loY, p[1]);
      hiX = Math.max(hiX, p[0]);
      hiY = Math.max(hiY, p[1]);
    }
  }
  return { loX, loY, width: hiX - loX, height: hiY - loY };
}

function shifted(curves: Curve[], loX: number, loY: number): Curve[] {
  return curves.map((c) => ({ closed: c.closed, points: c.points.map(([x, y]) => [x - loX, y - loY]) }));
}

function plainSize(width: number, height: number, unit: string): string {
  const digits = unit === "in" ? 2 : 1;
  return `${width.toFixed(digits)} x ${height.toFixed(digits)} ${unit}`;
}

/** A file's size in its own unit, then the other, for anyone working in either. */
function sizeText(width: number, height: number, unit: string): string {
  const other =
    unit === "in"
      ? plainSize(width * MM_PER_INCH, height * MM_PER_INCH, "mm")
      : plainSize(width / MM_PER_INCH, height / MM_PER_INCH, "in");
  return `${plainSize(width, height, unit)} (${other})`;
}

function svgSizeText(svg: SvgResult, units?: DxfUnits): string {
  return units === "in"
    ? sizeText(svg.widthMm / MM_PER_INCH, svg.heightMm / MM_PER_INCH, "in")
    : sizeText(svg.widthMm, svg.heightMm, "mm");
}

/**
 * The fit crops to the art and can trim it slightly, leaving it a fraction under the size asked for. Scale the result
 * onto the requested size; the change is far smaller than the 5% margin on line widths.
 */
function exactSize(map: LabelMap, box: { widthMm?: number; heightMm?: number }): LabelMap {
  const art = extents(boundaryChains(map).map((c) => c.points));
  const fits: number[] = [];
  if (box.widthMm) fits.push(box.widthMm / art.width);
  if (box.heightMm) fits.push(box.heightMm / art.height);
  return fits.length ? { ...map, cellMm: map.cellMm * Math.min(...fits) } : map;
}

/** One nozzle's fit at the exact size asked for: what every fitted file, and the export preview, is made from. */
export function fitAtSize(
  map: LabelMap,
  nozzleMm: number,
  fit: JobRequest["fit"],
  box: { widthMm?: number; heightMm?: number },
  onProgress?: FitProgress,
): NozzleResult {
  const raw = fitToNozzle(map, { nozzleMm, ...fit }, box, onProgress);
  return { report: raw.report, map: exactSize(raw.map, box) };
}

/** Fitted art as the DXF and 3MF draw it: the same simplified edges, filled, for the export preview. */
export function outlineSvg(map: LabelMap): { text: string; widthMm: number; heightMm: number } {
  const loops = labelLoops(boundaryChains(map), map.cellMm, EDGE_TOL_MM);
  const art = extents([...loops.values()].flat());
  const point = ([x, y]: Point) => `${(x - art.loX).toFixed(4)} ${(art.height - y + art.loY).toFixed(4)}`;
  const groups = [...loops.keys()]
    .sort((a, b) => a - b)
    .map((label) => {
      const d = (loops.get(label) as Point[][]).map((l) => `M${l.map(point).join("L")}Z`).join("");
      const [r, g, b] = map.colors[label];
      return `<path fill="rgb(${r},${g},${b})" fill-rule="evenodd" d="${d}"/>`;
    });
  const w = art.width.toFixed(4);
  const h = art.height.toFixed(4);
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">${groups.join("")}</svg>`,
    widthMm: art.width,
    heightMm: art.height,
  };
}

function nozzleTag(n: number): string {
  return `n${n}`;
}

export function runJob(map: LabelMap, r: JobRequest, wasm: ManifoldToplevel | null, progress?: Progress): JobResult {
  const files: OutputFile[] = [];
  const findings: Finding[] = [];
  const nozzles: NozzleResult[] = [];
  const box = { widthMm: r.widthMm, heightMm: r.heightMm };
  const stepCount = 1 + r.nozzles.length;
  let svg: SvgResult | undefined;
  if (r.svg?.source === "art") {
    progress?.("Fitting curves", 0);
    svg = vectorize(map, r.title, box, r.svg);
    const bytes = enc.encode(svg.text);
    const size = svgSizeText(svg, r.svg.units);
    files.push({ name: `${r.title}.svg`, kind: "svg", bytes, nozzleMm: null, sizeText: size });
    findings.push(...prefix("SVG", verifySvg(dec.decode(bytes), r.widthMm, r.heightMm)));
  }
  if (r.svg?.source === "line") {
    const lineMm = r.svg.lineMm ?? 0.15;
    const name = `${lineMm} mm lines`;
    progress?.(`Fitting to ${name}`, 0);
    const fitted = fitAtSize(map, lineMm, LINE_FIT, box, (message, part) =>
      progress?.(`${message} (${name})`, (0.8 * part) / stepCount),
    );
    findings.push(...fitFindings(fitted.report, name));
    svg = writeSvg(svgColors(fitted.map, r.svg.tolMm), {
      title: `${r.title}_line${lineMm}`,
      backdrop: r.svg.backdrop,
      units: r.svg.units,
    });
    files.push({
      name: `${r.title}_line${lineMm}.svg`,
      kind: "svg",
      bytes: enc.encode(svg.text),
      nozzleMm: null,
      sizeText: svgSizeText(svg, r.svg.units),
    });
    findings.push(...prefix("SVG", verifySvg(svg.text, r.widthMm, r.heightMm)));
  }
  const needsFit = r.dxf || r.plate || r.svg?.source === "nozzle";
  if (needsFit) {
    r.nozzles.forEach((n, i) => {
      progress?.(`Fitting to the ${n} mm nozzle`, (i + 1) / stepCount);
      const fitted = fitAtSize(map, n, r.fit, box, (message, part) =>
        progress?.(`${message} (${n} mm nozzle)`, (i + 1 + 0.8 * part) / stepCount),
      );
      const result: NozzleResult = { report: fitted.report, map: fitted.map };
      const tag = nozzleTag(n);
      findings.push(...fitFindings(fitted.report));
      const chains = boundaryChains(fitted.map);
      if (r.dxf) {
        const all = chainsToCurves(chains, EDGE_TOL_MM, fitted.map.cellMm);
        const art = extents(all.map((c) => c.points));
        const curves = shifted(all, art.loX, art.loY);
        const text = writeDxf(curves, r.dxf.units);
        const k = r.dxf.units === "in" ? 1 / MM_PER_INCH : 1;
        files.push({
          name: `${r.title}_${tag}.dxf`,
          kind: "dxf",
          bytes: enc.encode(text),
          nozzleMm: n,
          sizeText: sizeText(art.width * k, art.height * k, r.dxf.units),
        });
        findings.push(
          ...prefix(`DXF ${n} mm`, verifyDxf(text, r.widthMm && r.widthMm * k, r.heightMm && r.heightMm * k)),
        );
        if (r.dxf.perColor) {
          const loops = labelLoops(chains, fitted.map.cellMm, EDGE_TOL_MM);
          for (const [label, list] of loops) {
            const own = list.map((points) => ({ points, closed: true }));
            const name = fitted.map.names[label];
            // The same origin as the main file, so the files line up when stacked.
            const t = writeDxf(shifted(own, art.loX, art.loY), r.dxf.units, name.toUpperCase());
            const own2 = extents(list);
            files.push({
              name: `${r.title}_${tag}_${name}.dxf`,
              kind: "dxf",
              bytes: enc.encode(t),
              nozzleMm: n,
              sizeText: sizeText(own2.width * k, own2.height * k, r.dxf.units),
            });
          }
        }
      }
      if (r.svg?.source === "nozzle") {
        const s = writeSvg(svgColors(fitted.map, r.svg.tolMm), {
          title: `${r.title}_${tag}`,
          backdrop: r.svg.backdrop,
          units: r.svg.units,
        });
        files.push({
          name: `${r.title}_${tag}.svg`,
          kind: "svg",
          bytes: enc.encode(s.text),
          nozzleMm: n,
          sizeText: svgSizeText(s, r.svg.units),
        });
        findings.push(...prefix(`SVG ${n} mm`, verifySvg(s.text, r.widthMm, r.heightMm)));
        svg ??= s;
      }
      if (r.plate) {
        if (!wasm) throw new Error("The 3D kernel is not loaded.");
        const { layer, depth } = layerHeights(n, r.plate.layerMm, r.plate.insetLayers, r.plate.insetMm);
        const baseMm = Math.max(1, Math.round((r.plate.baseMm ?? 1.2) / layer)) * layer;
        const parts = buildParts(wasm, fitted.map, chains, { ...r.plate, baseMm, insetMm: depth });
        result.parts = parts;
        const made = new Set(parts.map((p) => p.name));
        for (let v = 1; v < fitted.map.names.length; v++) {
          if (fitted.map.data.includes(v) && !made.has(fitted.map.names[v])) {
            findings.push({
              severity: "warning",
              code: "3mf.color",
              message: `3MF ${n} mm: ${fitted.map.names[v]} is too small to print at this size and was left out.`,
            });
          }
        }
        if (Math.abs(depth / layer - Math.round(depth / layer)) > 1e-6) {
          findings.push({
            severity: "warning",
            code: "3mf.layers",
            message: `The ${depth} mm inset is not a whole number of ${layer} mm layers.`,
          });
        }
        const project = r.plate.template
          ? projectFromTemplate(
              r.plate.template,
              parts.map((p) => hexColor(p.color)),
            )
          : undefined;
        const bytes = writeThreeMf(parts, { title: `${r.title}_${tag}`, project });
        const { lo, hi } = partBounds(parts);
        const plate = `${plainSize(hi[0] - lo[0], hi[1] - lo[1], "mm").replace(" mm", "")} x ${(hi[2] - lo[2]).toFixed(1)} mm`;
        files.push({ name: `${r.title}_${tag}.3mf`, kind: "3mf", bytes, nozzleMm: n, sizeText: plate });
        findings.push(...prefix(`3MF ${n} mm`, verifyThreeMf(bytes, r.plate.materials).findings));
        if (r.plate.template) {
          const bed = String(r.plate.template.printer);
          findings.push({ severity: "pass", code: "3mf.project", message: `3MF ${n} mm: Bambu project for ${bed}` });
        } else if (!findings.some((f) => f.code === "3mf.plain")) {
          findings.push({
            severity: "warning",
            code: "3mf.plain",
            message: "Plain 3MF: use File > Import in Bambu Studio, or add a Bambu project template.",
          });
        }
      }
      nozzles.push(result);
    });
  }
  progress?.("Done", 1);
  return { files, findings, nozzles, svg };
}

function prefix(name: string, list: Finding[]): Finding[] {
  return list.map((f) => ({ ...f, message: `${name}: ${f.message}` }));
}

/** What a fit left unresolved and how much it moved, in words. */
export function fitFindings(rep: FitReport, name = `${rep.nozzleMm} mm nozzle`): Finding[] {
  const out: Finding[] = [];
  const thin = Object.values(rep.features).reduce((s, r) => s + r.count, 0);
  if (thin || rep.gap.count) {
    out.push({
      severity: "fault",
      code: "fit.left",
      message: `${name}: ${thin} thin features and ${rep.gap.count} narrow gaps are left. The detail conflicts at this size.`,
    });
  } else {
    out.push({ severity: "pass", code: "fit.left", message: `${name}: every line and gap is printable` });
  }
  if (rep.changedPct > 25) {
    out.push({
      severity: "warning",
      code: "fit.changed",
      message: `${name}: the fit changed ${rep.changedPct}% of the art. Print larger or use a smaller nozzle.`,
    });
  } else {
    out.push({
      severity: "pass",
      code: "fit.changed",
      message: `${name}: ${rep.changedPct}% of the art changed`,
    });
  }
  return out;
}
