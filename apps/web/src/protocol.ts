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
  svg: {
    source: "art" | "nozzle" | "line";
    lineMm?: number;
    units: DxfUnits;
    backdrop?: string;
    tolMm: number;
  } | null;
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

export interface FitRequest {
  trace: TraceRequest;
  /** The nozzle, or the smallest line when line is set. */
  nozzleMm: number;
  fit: ExportRequest["fit"];
  line: boolean;
}

export type WorkerRequest =
  | { op: "suggest"; image: ImageData2; crop: Box | null }
  | { op: "preview"; image: ImageData2; trace: TraceRequest; tolMm: number; full: boolean }
  | { op: "fit"; image: ImageData2; request: FitRequest }
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
  sizeText: string;
}

export interface PlatePart {
  name: string;
  color: Rgb;
  vertices: Float32Array;
  triangles: Uint32Array;
}

/** The art as the files will have it at one nozzle. */
export interface FitPicture {
  nozzleMm: number;
  changedPct: number;
  widthMm: number;
  heightMm: number;
  /** Drawn from the same edges as the DXF and 3MF. */
  svg: string;
  findings: Finding[];
}

export interface NozzleSummary extends FitPicture {
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
