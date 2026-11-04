/** Messages between the page and its workers. Everything here must survive structured cloning. */
import type { Box, Rgb, TraceOptions } from "@png2cad/core";
import type { BambuTemplate, DxfUnits, Finding, PlateStyle } from "@png2cad/formats";

export interface ImageData2 {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface TraceRequest {
  mode: TraceOptions["mode"];
  palette: Rgb[];
  widthMm?: number;
  heightMm?: number;
  speckMm: number;
  keepEnclosed: boolean;
  crop: Box | null;
}

export interface ExportRequest {
  title: string;
  trace: TraceRequest;
  nozzles: number[];
  fit: { featureFactor: number; gapFactor: number };
  svg: { source: "art" | "nozzle"; backdrop?: string; tolMm: number } | null;
  dxf: { units: DxfUnits; perColor: boolean } | null;
  plate: {
    style: PlateStyle;
    insetLayers: number;
    baseMm: number;
    reliefMm: number;
    marginMm: number;
    template?: BambuTemplate;
  } | null;
}

export type WorkerRequest =
  | { op: "suggest"; image: ImageData2; crop: Box | null }
  | { op: "preview"; image: ImageData2; trace: TraceRequest; tolMm: number }
  | { op: "export"; image: ImageData2; request: ExportRequest };

export interface SuggestResult {
  mode: TraceOptions["mode"];
  palette: Rgb[];
}

export interface ColorStat {
  name: string;
  color: Rgb;
  /** Share of the artwork, in percent. */
  share: number;
}

export interface PreviewResult {
  svg: string;
  widthMm: number;
  heightMm: number;
  paths: number;
  nodes: number;
  colors: ColorStat[];
}

export interface FileResult {
  name: string;
  kind: "svg" | "dxf" | "3mf";
  bytes: Uint8Array;
  nozzleMm: number | null;
}

export interface PlatePart {
  name: string;
  color: Rgb;
  vertices: Float32Array;
  triangles: Uint32Array;
}

export interface NozzleSummary {
  nozzleMm: number;
  changedPct: number;
  widthMm: number;
  heightMm: number;
  /** The fitted art, so the view can show what the nozzle does to it. */
  svg: string;
  parts: PlatePart[] | null;
}

export interface ExportResult {
  files: FileResult[];
  findings: Finding[];
  nozzles: NozzleSummary[];
}

export type WorkerResponse =
  | { type: "progress"; message: string; done: number }
  | { type: "done"; result: unknown }
  | { type: "error"; message: string };
