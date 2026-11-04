/** All image and geometry work happens here, never on the page's thread. */
import { suggestTrace, traceImage } from "@png2cad/core";
import { runJob, vectorize, type JobRequest } from "@png2cad/formats";
import Module, { type ManifoldToplevel } from "manifold-3d";
import wasmUrl from "manifold-3d/manifold.wasm?url";
import type {
  ColorStat,
  ExportRequest,
  ExportResult,
  ImageData2,
  PreviewResult,
  SuggestResult,
  TraceRequest,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

const post = (m: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(m, { transfer });
const progress = (message: string, done: number) => post({ type: "progress", message, done });

let kernel: Promise<ManifoldToplevel> | null = null;
function loadKernel(): Promise<ManifoldToplevel> {
  kernel ??= Module({ locateFile: () => wasmUrl }).then((m) => {
    m.setup();
    return m;
  });
  return kernel;
}

function traceOptions(t: TraceRequest, maxCells: number) {
  return {
    mode: t.mode,
    palette: t.mode === "colors" ? t.palette : undefined,
    background: t.mode === "mask" ? t.palette[0] : undefined,
    foreground: t.mode === "mask" ? t.palette[1] : undefined,
    widthMm: t.widthMm,
    heightMm: t.heightMm,
    speckMm: t.speckMm,
    keepEnclosed: t.keepEnclosed,
    crop: t.crop ?? undefined,
    maxCells,
  };
}

function preview(image: ImageData2, t: TraceRequest, tolMm: number): PreviewResult {
  progress("Tracing", 0.1);
  const map = traceImage(image, traceOptions(t, 1_500_000));
  progress("Fitting curves", 0.6);
  const svg = vectorize(map, "preview", { widthMm: t.widthMm, heightMm: t.heightMm }, { source: "art", tolMm });
  const counts = new Array<number>(map.names.length).fill(0);
  for (let i = 0; i < map.data.length; i++) counts[map.data[i]]++;
  const art = map.data.length - counts[0];
  const colors: ColorStat[] = map.names.slice(1).map((name, i) => ({
    name,
    color: map.colors[i + 1],
    share: art ? (100 * counts[i + 1]) / art : 0,
  }));
  return { svg: svg.text, widthMm: svg.widthMm, heightMm: svg.heightMm, paths: svg.paths, nodes: svg.nodes, colors };
}

async function runExport(image: ImageData2, r: ExportRequest): Promise<ExportResult> {
  progress("Tracing", 0.02);
  const map = traceImage(image, traceOptions(r.trace, 8_000_000));
  const wasm = r.plate ? await loadKernel() : null;
  const job: JobRequest = {
    title: r.title,
    widthMm: r.trace.widthMm,
    heightMm: r.trace.heightMm,
    nozzles: r.nozzles,
    fit: r.fit,
    svg: r.svg ?? undefined,
    dxf: r.dxf ?? undefined,
    plate: r.plate ?? undefined,
  };
  const result = runJob(map, job, wasm, (message, done) => progress(message, 0.05 + 0.9 * done));
  return {
    files: result.files,
    findings: result.findings,
    nozzles: result.nozzles.map((n) => ({
      nozzleMm: n.report.nozzleMm,
      changedPct: n.report.changedPct,
      widthMm: n.report.widthMm,
      heightMm: n.report.heightMm,
      svg: vectorize(n.map, "fitted", {}, { source: "art", tolMm: r.svg?.tolMm }).text,
      parts: n.parts ?? null,
    })),
  };
}

function transferables(result: unknown): Transferable[] {
  const r = result as Partial<ExportResult>;
  const list: Transferable[] = [];
  for (const f of r.files ?? []) list.push(f.bytes.buffer as ArrayBuffer);
  for (const n of r.nozzles ?? []) {
    for (const p of n.parts ?? []) list.push(p.vertices.buffer as ArrayBuffer, p.triangles.buffer as ArrayBuffer);
  }
  return list;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const m = event.data;
  try {
    let result: PreviewResult | ExportResult | SuggestResult;
    if (m.op === "suggest") result = suggestTrace(m.image, m.crop ?? undefined);
    else if (m.op === "preview") result = preview(m.image, m.trace, m.tolMm);
    else result = await runExport(m.image, m.request);
    post({ type: "done", result }, transferables(result));
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
