/** The app's one store: settings and results. Components read it; only actions here start work. */
import { MM_PER_INCH, type Box, type Rgb } from "@png2cad/core";
import type { BambuTemplate, DxfUnits, PlateStyle } from "@png2cad/formats";
import { zipSync } from "fflate";
import { create } from "zustand";
import { Cancelled, cancel, run } from "./engine";
import type { ExportRequest, ExportResult, ImageData2, PreviewResult, SuggestResult, TraceRequest } from "./protocol";

export type View = "source" | "vector" | "plate";

export interface Settings {
  mode: "mask" | "colors";
  sizeBy: "width" | "height";
  size: number;
  unit: "mm" | "in";
  speckMm: number;
  keepEnclosed: boolean;
  tolMm: number;
  makeSvg: boolean;
  svgFitted: boolean;
  backdrop: string | null;
  makeDxf: boolean;
  dxfUnits: DxfUnits;
  perColor: boolean;
  makePlate: boolean;
  style: PlateStyle;
  insetLayers: number;
  baseMm: number;
  reliefMm: number;
  marginMm: number;
  nozzles: number[];
  featureFactor: number;
  gapFactor: number;
}

export const DEFAULTS: Settings = {
  mode: "mask",
  sizeBy: "width",
  size: 100,
  unit: "mm",
  speckMm: 0.15,
  keepEnclosed: true,
  tolMm: 0.02,
  makeSvg: true,
  svgFitted: false,
  backdrop: null,
  makeDxf: true,
  dxfUnits: "in",
  perColor: false,
  makePlate: true,
  style: "inset",
  insetLayers: 10,
  baseMm: 1.2,
  reliefMm: 0.6,
  marginMm: 2,
  nozzles: [0.4],
  featureFactor: 1.05,
  gapFactor: 1,
};

const SAVED = "png2cad.settings";
const SAVED_TEMPLATE = "png2cad.template";

function read<T>(key: string): T | null {
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage is a convenience: the app works the same without it.
  }
}

interface State {
  settings: Settings;
  template: BambuTemplate | null;
  image: ImageData2 | null;
  imageUrl: string | null;
  title: string;
  crop: Box | null;
  palette: Rgb[];
  /** Set once the person changes a color, so a new crop stops replacing their palette. */
  paletteEdited: boolean;
  view: View;
  preview: PreviewResult | null;
  previewBusy: boolean;
  previewError: string | null;
  exportBusy: boolean;
  exportStep: { message: string; done: number } | null;
  exportError: string | null;
  result: ExportResult | null;
  /** Which version the vector view shows: null is the artwork, a number is a nozzle's fitted result. */
  shownNozzle: number | null;
  setView: (view: View) => void;
  setShownNozzle: (nozzle: number | null) => void;
  update: (patch: Partial<Settings>) => void;
  setPalette: (palette: Rgb[]) => void;
  setCrop: (crop: Box | null) => Promise<void>;
  setTemplate: (template: BambuTemplate | null) => void;
  loadImage: (file: Blob, name: string) => Promise<void>;
  clearImage: () => void;
  exportFiles: () => Promise<void>;
  cancelExport: () => void;
}

/** The size in millimeters as the engine wants it: one side set, the other following the art. */
export function sizeBox(s: Settings): { widthMm?: number; heightMm?: number } {
  const mm = s.unit === "in" ? s.size * MM_PER_INCH : s.size;
  return s.sizeBy === "width" ? { widthMm: mm } : { heightMm: mm };
}

function traceRequest(state: State): TraceRequest {
  const s = state.settings;
  return {
    mode: s.mode,
    palette: state.palette,
    speckMm: s.speckMm,
    keepEnclosed: s.keepEnclosed,
    crop: state.crop,
    ...sizeBox(s),
  };
}

function exportRequest(state: State): ExportRequest {
  const s = state.settings;
  return {
    title: state.title,
    trace: traceRequest(state),
    nozzles: s.nozzles,
    fit: { featureFactor: s.featureFactor, gapFactor: s.gapFactor },
    svg: s.makeSvg
      ? { source: s.svgFitted ? "nozzle" : "art", backdrop: s.backdrop ?? undefined, tolMm: s.tolMm }
      : null,
    dxf: s.makeDxf ? { units: s.dxfUnits, perColor: s.perColor } : null,
    plate: s.makePlate
      ? {
          style: s.style,
          insetLayers: s.insetLayers,
          baseMm: s.baseMm,
          reliefMm: s.reliefMm,
          marginMm: s.marginMm,
          template: state.template ?? undefined,
        }
      : null,
  };
}

let previewTimer: ReturnType<typeof setTimeout> | undefined;

export const useApp = create<State>((set, get) => {
  /** The picture updates by itself shortly after a change. The old one stays until the new one arrives. */
  const refresh = (delay = 250) => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const state = get();
      if (!state.image || !state.settings.size || state.palette.length < 2) return;
      set({ previewBusy: true });
      try {
        const preview = await run<PreviewResult>("preview", {
          op: "preview",
          image: state.image,
          trace: traceRequest(state),
          tolMm: state.settings.tolMm,
        });
        const first = get().preview === null;
        set({ preview, previewBusy: false, previewError: null, view: first ? "vector" : get().view });
      } catch (error) {
        if (error instanceof Cancelled) return;
        set({ previewBusy: false, previewError: error instanceof Error ? error.message : String(error) });
      }
    }, delay);
  };

  /** Read the main colors of the part of the image in use, and pick the trace mode that suits them. */
  const suggest = async (image: ImageData2, crop: Box | null) => {
    try {
      const found = await run<SuggestResult>("preview", { op: "suggest", image, crop });
      const settings = { ...get().settings, mode: found.mode };
      write(SAVED, settings);
      set({ settings, palette: found.palette });
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error;
    }
  };

  /** Anything that changes the art makes earlier files out of date. */
  const stale = () => {
    cancel("export");
    set({ result: null, exportBusy: false, exportStep: null, shownNozzle: null });
  };

  return {
    settings: { ...DEFAULTS, ...read<Partial<Settings>>(SAVED) },
    template: read<BambuTemplate>(SAVED_TEMPLATE),
    image: null,
    imageUrl: null,
    title: "artwork",
    crop: null,
    palette: [],
    paletteEdited: false,
    view: "source",
    preview: null,
    previewBusy: false,
    previewError: null,
    exportBusy: false,
    exportStep: null,
    exportError: null,
    result: null,
    shownNozzle: null,
    setView: (view) => set({ view }),
    setShownNozzle: (shownNozzle) => set({ shownNozzle }),
    update: (patch) => {
      const settings = { ...get().settings, ...patch };
      write(SAVED, settings);
      set({ settings });
      stale();
      refresh();
    },
    setPalette: (palette) => {
      set({ palette, paletteEdited: true });
      stale();
      refresh();
    },
    setCrop: async (crop) => {
      set({ crop });
      stale();
      const { image, paletteEdited } = get();
      if (image && !paletteEdited) await suggest(image, crop);
      refresh(0);
    },
    setTemplate: (template) => {
      write(SAVED_TEMPLATE, template);
      set({ template });
      stale();
    },
    loadImage: async (file, name) => {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        set({ previewError: "That file could not be read as an image. Use a PNG, JPG, WebP, GIF or BMP." });
        return;
      }
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const image: ImageData2 = { data: pixels.data, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      const old = get().imageUrl;
      if (old) URL.revokeObjectURL(old);
      set({
        image,
        imageUrl: URL.createObjectURL(file),
        title: name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "artwork",
        crop: null,
        preview: null,
        previewError: null,
        palette: [],
        paletteEdited: false,
        view: "source",
      });
      stale();
      await suggest(image, null);
      refresh(0);
    },
    clearImage: () => {
      cancel("preview");
      stale();
      const old = get().imageUrl;
      if (old) URL.revokeObjectURL(old);
      set({
        image: null,
        imageUrl: null,
        preview: null,
        palette: [],
        paletteEdited: false,
        crop: null,
        view: "source",
        previewError: null,
      });
    },
    exportFiles: async () => {
      const state = get();
      if (!state.image) return;
      set({ exportBusy: true, exportError: null, result: null, exportStep: { message: "Starting", done: 0 } });
      try {
        const result = await run<ExportResult>(
          "export",
          { op: "export", image: state.image, request: exportRequest(state) },
          (message, done) => set({ exportStep: { message, done } }),
        );
        set({ result, exportBusy: false, exportStep: null });
      } catch (error) {
        if (error instanceof Cancelled) return;
        set({
          exportBusy: false,
          exportStep: null,
          exportError: error instanceof Error ? error.message : String(error),
        });
      }
    },
    cancelExport: () => {
      cancel("export");
      set({ exportBusy: false, exportStep: null });
    },
  };
});

export function download(name: string, bytes: Uint8Array, type = "application/octet-stream"): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Every file in one ZIP, with fixed times so the same files give the same bytes. */
export function zipFiles(result: ExportResult): Uint8Array {
  const when = { mtime: new Date(Date.UTC(2020, 0, 1)) };
  const files: Record<string, [Uint8Array, typeof when]> = {};
  for (const f of result.files) files[f.name] = [f.bytes, when];
  return zipSync(files, { level: 1 });
}
