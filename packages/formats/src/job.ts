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
} from "@png2cad/core";
import { writeDxf, type DxfUnits } from "./dxf.ts";
import { buildParts, labelLoops, type Part, type PlateOptions } from "./mesh.ts";
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
}

export interface SvgRequest {
  /** art comes from the unfitted map, for design programs; nozzle has the fitted line widths. */
  source: "art" | "nozzle";
  backdrop?: string;
  tolMm?: number;
}

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
  return writeSvg(svgColors(map, svg?.tolMm), { title, backdrop: svg?.backdrop, ...box });
}

function shifted(curves: Curve[]): Curve[] {
  let loX = Infinity;
  let loY = Infinity;
  for (const c of curves) {
    for (const p of c.points) {
      loX = Math.min(loX, p[0]);
      loY = Math.min(loY, p[1]);
    }
  }
  return curves.map((c) => ({ closed: c.closed, points: c.points.map(([x, y]) => [x - loX, y - loY]) }));
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
    files.push({ name: `${r.title}.svg`, kind: "svg", bytes, nozzleMm: null });
    findings.push(...prefix("SVG", verifySvg(dec.decode(bytes), r.widthMm, r.heightMm)));
  }
  const needsFit = r.dxf || r.plate || r.svg?.source === "nozzle";
  if (needsFit) {
    r.nozzles.forEach((n, i) => {
      progress?.(`Fitting to the ${n} mm nozzle`, (i + 1) / stepCount);
      const fitted = fitToNozzle(map, { nozzleMm: n, ...r.fit }, box);
      const result: NozzleResult = { report: fitted.report, map: fitted.map };
      const tag = nozzleTag(n);
      nozzleFindings(fitted.report, fitted.map, findings);
      const chains = boundaryChains(fitted.map);
      if (r.dxf) {
        const curves = shifted(chainsToCurves(chains, 0.0127, fitted.map.cellMm));
        const text = writeDxf(curves, r.dxf.units);
        files.push({ name: `${r.title}_${tag}.dxf`, kind: "dxf", bytes: enc.encode(text), nozzleMm: n });
        const k = r.dxf.units === "in" ? 1 / MM_PER_INCH : 1;
        findings.push(
          ...prefix(`DXF ${n} mm`, verifyDxf(text, r.widthMm && r.widthMm * k, r.heightMm && r.heightMm * k)),
        );
        if (r.dxf.perColor) {
          const loops = labelLoops(chains, fitted.map.cellMm, 0.0127);
          for (const [label, list] of loops) {
            const own = list.map((points) => ({ points, closed: true }));
            const name = fitted.map.names[label];
            const t = writeDxf(shifted(own), r.dxf.units, name.toUpperCase());
            files.push({ name: `${r.title}_${tag}_${name}.dxf`, kind: "dxf", bytes: enc.encode(t), nozzleMm: n });
          }
        }
      }
      if (r.svg?.source === "nozzle") {
        const s = writeSvg(svgColors(fitted.map, r.svg.tolMm), {
          title: `${r.title}_${tag}`,
          backdrop: r.svg.backdrop,
        });
        files.push({ name: `${r.title}_${tag}.svg`, kind: "svg", bytes: enc.encode(s.text), nozzleMm: n });
        findings.push(...prefix(`SVG ${n} mm`, verifySvg(s.text)));
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
        files.push({ name: `${r.title}_${tag}.3mf`, kind: "3mf", bytes, nozzleMm: n });
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

function nozzleFindings(rep: FitReport, map: LabelMap, out: Finding[]): void {
  const n = rep.nozzleMm;
  const thin = Object.values(rep.features).reduce((s, r) => s + r.count, 0);
  if (thin || rep.gap.count) {
    out.push({
      severity: "fault",
      code: "fit.left",
      message: `${n} mm nozzle: ${thin} thin features and ${rep.gap.count} narrow gaps are left. The detail conflicts at this size.`,
    });
  } else {
    out.push({ severity: "pass", code: "fit.left", message: `${n} mm nozzle: every line and gap is printable` });
  }
  if (rep.changedPct > 25) {
    out.push({
      severity: "warning",
      code: "fit.changed",
      message: `${n} mm nozzle: the fit changed ${rep.changedPct}% of the art. Print larger or use a smaller nozzle.`,
    });
  } else {
    out.push({
      severity: "pass",
      code: "fit.changed",
      message: `${n} mm nozzle: ${rep.changedPct}% of the art changed`,
    });
  }
  void map;
}
