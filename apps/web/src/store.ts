/** The app's one store: settings and results. Components read it; only actions here start work. */
import { MM_PER_INCH, type Box, type Rgb } from "@png2cad/core";
import type { BambuTemplate, PlateStyle } from "@png2cad/formats";
import { zipSync } from "fflate";
import { create } from "zustand";
import { drawingSurface, readSize } from "./canvas";
import { Cancelled, cancel, run } from "./engine";
import type {
  ExportRequest,
  ExportResult,
  FitPicture,
  FitRequest,
  ImageData2,
  PreviewResult,
  SuggestResult,
  TraceRequest,
} from "./protocol";

export type View = "source" | "vector" | "fit" | "plate";

/** Which file to make. Each one has a tab holding only its own settings. */
export type Output = "svg" | "dxf" | "3mf";

const filesFor = (output: Output) => ({
  makeSvg: output === "svg",
  makeDxf: output === "dxf",
  makePlate: output === "3mf",
});

export interface Settings {
  mode: "mask" | "colors";
  sizeBy: "width" | "height";
  size: number;
  unit: "mm" | "in";
  speckMm: number;
  keepEnclosed: boolean;
  tolMm: number;
  output: Output;
  makeSvg: boolean;
  /** traced keeps every line as drawn; nozzle fits lines to the nozzle; width holds them to svgLineMm. */
  svgLines: "traced" | "nozzle" | "width";
  svgLineMm: number;
  backdrop: string | null;
  makeDxf: boolean;
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

/** One size in the comparison. It has no picture until its fit finishes. */
export interface CompareEntry {
  size: number;
  asked: string;
  request: FitRequest;
  picture: FitPicture | null;
  error: string | null;
}

/** The sizes compared, as multiples of the current one. Bigger is what keeps more detail. */
const COMPARE_STEPS = [1, 1.25, 1.5];

export function compareSizes(s: Pick<Settings, "size" | "unit">): number[] {
  return COMPARE_STEPS.map((k) => Number((s.size * k).toFixed(s.unit === "in" ? 2 : 1)));
}

export const DEFAULTS: Settings = {
  mode: "mask",
  sizeBy: "width",
  size: 100,
  unit: "mm",
  speckMm: 0.15,
  keepEnclosed: true,
  tolMm: 0.02,
  output: "svg",
  makeSvg: true,
  svgLines: "traced",
  svgLineMm: 0.15,
  backdrop: null,
  makeDxf: false,
  perColor: false,
  makePlate: false,
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
  /** True when the picture came from the files' grid rather than the quick one. */
  previewFull: boolean;
  previewBusy: boolean;
  previewError: string | null;
  /** Set when the image had to be read smaller than it is. */
  imageNote: string | null;
  exportBusy: boolean;
  exportStep: { message: string; done: number } | null;
  exportError: string | null;
  result: ExportResult | null;
  /** The export preview, made ahead of the files. The old one stays on screen until the new one arrives. */
  fit: FitPicture | null;
  fitBusy: boolean;
  fitStep: { message: string; done: number } | null;
  fitError: string | null;
  /** False once a change means the picture on screen is no longer what the files would be. */
  fitCurrent: boolean;
  /** Which nozzle the export preview shows: null is the first one in use. */
  shownNozzle: number | null;
  compareOn: boolean;
  compare: CompareEntry[];
  compareBusy: boolean;
  /** How far the comparison has come: which of the sizes still needed, and how far through that one. */
  compareStep: { position: number; count: number; message: string; done: number } | null;
  setView: (view: View) => void;
  setShownNozzle: (nozzle: number | null) => void;
  setCompareOn: (on: boolean) => void;
  showFullDetail: () => void;
  checkSize: () => void;
  cancelCheck: () => void;
  chooseSize: (size: number) => void;
  update: (patch: Partial<Settings>) => void;
  setOutput: (output: Output) => void;
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
      ? {
          source: s.svgLines === "nozzle" ? "nozzle" : s.svgLines === "width" ? "line" : "art",
          lineMm: s.svgLineMm,
          units: s.unit,
          backdrop: s.backdrop ?? undefined,
          tolMm: s.tolMm,
        }
      : null,
    // The DXF speaks the same units as the size: 100 mm comes out as 100, never as 3.94.
    dxf: s.makeDxf ? { units: s.unit, perColor: s.perColor } : null,
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
/** Counts comparisons, so one that has been replaced stops at its next step. */
let compareRun = 0;
/** What the export preview on screen, or on its way, was asked for. */
let fitAsked: string | null = null;

const usesNozzles = (s: Settings): boolean => s.makeDxf || s.makePlate || (s.makeSvg && s.svgLines === "nozzle");

/** Whether this width is the SVG's smallest line rather than a nozzle. */
export function isLineTarget(s: Settings, width: number): boolean {
  return s.makeSvg && s.svgLines === "width" && width === s.svgLineMm && !(usesNozzles(s) && s.nozzles.includes(width));
}

/** Every fit the chosen files call for. An SVG as traced has none. */
export function previewTargets(s: Settings): number[] {
  const nozzles = usesNozzles(s) ? s.nozzles : [];
  return isLineTarget(s, s.svgLineMm) && s.svgLineMm > 0 ? [...nozzles, s.svgLineMm] : nozzles;
}

/** The nozzle or line width the export preview is showing. */
export function previewNozzle(state: Pick<State, "shownNozzle" | "settings">): number {
  const { shownNozzle, settings } = state;
  const targets = previewTargets(settings);
  return shownNozzle !== null && targets.includes(shownNozzle) ? shownNozzle : (targets[0] ?? settings.nozzles[0]);
}

function finishedPicture(state: Pick<State, "result" | "shownNozzle" | "settings">) {
  const width = previewNozzle(state);
  if (isLineTarget(state.settings, width)) return null;
  return state.result?.nozzles.find((n) => n.nozzleMm === width) ?? null;
}

/** The picture for the export preview: finished files win, since they are what will be downloaded. */
export function previewPicture(state: Pick<State, "result" | "fit" | "shownNozzle" | "settings">): FitPicture | null {
  return finishedPicture(state) ?? state.fit;
}

function fitRequest(state: State, size = state.settings.size): FitRequest {
  const s = state.settings;
  return {
    trace: traceRequest({ ...state, settings: { ...s, size } }),
    nozzleMm: previewNozzle(state),
    fit: { featureFactor: s.featureFactor, gapFactor: s.gapFactor },
    line: isLineTarget(s, previewNozzle(state)),
  };
}

const canFit = (state: State): boolean =>
  state.image !== null && state.settings.size > 0 && state.palette.length >= 2 && !state.exportBusy;

function savedSettings(): Settings {
  const s = { ...DEFAULTS, ...read<Partial<Settings>>(SAVED) };
  // Settings saved by an earlier version can name a choice that no longer exists.
  const output = ["svg", "dxf", "3mf"].includes(s.output) ? s.output : DEFAULTS.output;
  return { ...s, output, ...filesFor(output) };
}

export const useApp = create<State>((set, get) => {
  /** The picture updates by itself shortly after a change. The old one stays until the new one arrives. */
  const refresh = (delay = 250) => {
    syncFit();
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => void loadPreview(false), delay);
  };

  const loadPreview = async (full: boolean) => {
    const state = get();
    if (!state.image || !state.settings.size || state.palette.length < 2) return;
    set({ previewBusy: true });
    try {
      const preview = await run<PreviewResult>("preview", {
        op: "preview",
        image: state.image,
        trace: traceRequest(state),
        tolMm: state.settings.tolMm,
        full,
      });
      const first = get().preview === null;
      set({
        preview,
        previewFull: full,
        previewBusy: false,
        previewError: null,
        view: first ? "vector" : get().view,
      });
    } catch (error) {
      if (error instanceof Cancelled) return;
      set({ previewBusy: false, previewError: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Ends whatever is fitting. Pictures already finished stay valid. */
  const stopFit = () => {
    compareRun++;
    cancel("fit");
    if (get().fitBusy) fitAsked = null;
    set({ fitBusy: false, fitStep: null, compareBusy: false, compareStep: null });
  };

  /** What the settings now call for, one entry per picture. */
  const wanted = (state: State): string[] =>
    state.compareOn
      ? compareSizes(state.settings).map((size) => JSON.stringify(fitRequest(state, size)))
      : [JSON.stringify(fitRequest(state))];

  /** After any change: a run for old settings is wasted, and the picture may no longer be what the files would be. */
  const syncFit = () => {
    const state = get();
    const want = wanted(state);
    const running = state.compareOn ? state.compare.map((c) => c.asked) : [fitAsked];
    if ((state.fitBusy || state.compareBusy) && !want.every((key) => running.includes(key))) stopFit();
    const now = get();
    const finished = finishedPicture(now) !== null;
    const current = now.compareOn
      ? want.every((key) => now.compare.some((c) => c.asked === key && c.picture))
      : finished || (now.fit !== null && want[0] === fitAsked);
    set({ fitCurrent: current });
  };

  /**
   * Each size is a full fit, so they run one after another in one worker: at the same time they would need the memory
   * of three. Pictures appear as they finish, and sizes already done are kept.
   */
  const startCompare = async () => {
    const id = ++compareRun;
    const state = get();
    if (!canFit(state) || !state.image) return;
    const done = finishedPicture(state);
    const plan = compareSizes(state.settings).map((size): CompareEntry => {
      const request = fitRequest(state, size);
      const asked = JSON.stringify(request);
      const old = state.compare.find((c) => c.asked === asked && c.picture);
      if (old) return old;
      const current = size === state.settings.size;
      const known = current ? (done ?? (asked === fitAsked && !state.fitBusy ? state.fit : null)) : null;
      return { size, asked, request, picture: known, error: null };
    });
    const change = (entry: CompareEntry, patch: Partial<CompareEntry>) =>
      set({ compare: get().compare.map((c) => (c.asked === entry.asked ? { ...c, ...patch } : c)) });
    const waiting = plan.filter((c) => !c.picture);
    set({ compare: plan, compareBusy: waiting.length > 0, compareStep: null });
    for (const [index, entry] of waiting.entries()) {
      const position = index + 1;
      set({ compareStep: { position, count: waiting.length, message: "Starting", done: 0 } });
      try {
        const picture = await run<FitPicture>(
          "fit",
          { op: "fit", image: state.image, request: entry.request },
          (message, done) => set({ compareStep: { position, count: waiting.length, message, done } }),
        );
        if (id !== compareRun) return;
        change(entry, { picture });
        if (entry.size === get().settings.size) {
          fitAsked = entry.asked;
          set({ fit: picture, fitError: null });
        }
      } catch (error) {
        if (error instanceof Cancelled || id !== compareRun) return;
        change(entry, { error: error instanceof Error ? error.message : String(error) });
      }
    }
    set({ compareBusy: false, compareStep: null });
    syncFit();
  };

  /**
   * The export preview runs the real fit on the files' grid, which can take minutes on large art. So it only runs when
   * asked: on every change it would also fit each half-typed size on the way to the one wanted.
   */
  const startFit = async () => {
    const state = get();
    if (!canFit(state) || !state.image) return;
    const request = fitRequest(state);
    fitAsked = JSON.stringify(request);
    set({ fitBusy: true, fitStep: null, fitError: null });
    try {
      const fit = await run<FitPicture>("fit", { op: "fit", image: state.image, request }, (message, done) =>
        set({ fitStep: { message, done } }),
      );
      set({ fit, fitBusy: false, fitStep: null, fitError: null });
    } catch (error) {
      if (error instanceof Cancelled) return;
      fitAsked = null;
      set({
        fitBusy: false,
        fitStep: null,
        fitError: error instanceof Error ? error.message : String(error),
      });
    }
    syncFit();
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
    set({ result: null, exportBusy: false, exportStep: null });
    syncFit();
  };

  return {
    settings: savedSettings(),
    template: read<BambuTemplate>(SAVED_TEMPLATE),
    image: null,
    imageUrl: null,
    title: "artwork",
    crop: null,
    palette: [],
    paletteEdited: false,
    view: "source",
    preview: null,
    previewFull: false,
    previewBusy: false,
    previewError: null,
    imageNote: null,
    exportBusy: false,
    exportStep: null,
    exportError: null,
    result: null,
    fit: null,
    fitBusy: false,
    fitStep: null,
    fitError: null,
    fitCurrent: false,
    shownNozzle: null,
    compareOn: false,
    compare: [],
    compareBusy: false,
    compareStep: null,
    setView: (view) => set({ view }),
    setShownNozzle: (shownNozzle) => {
      set({ shownNozzle });
      syncFit();
    },
    setCompareOn: (compareOn) => {
      stopFit();
      set({ compareOn });
      syncFit();
      // Turning it on is asking for the comparison, so it starts straight away.
      if (compareOn) void startCompare();
    },
    showFullDetail: () => {
      clearTimeout(previewTimer);
      void loadPreview(true);
    },
    checkSize: () => void (get().compareOn ? startCompare() : startFit()),
    cancelCheck: () => {
      stopFit();
      syncFit();
    },
    chooseSize: (size) => {
      const entry = get().compare.find((c) => c.size === size);
      stopFit();
      set({ compareOn: false, compare: [] });
      if (entry?.picture) {
        // Already fitted at this size, so there is no need to wait for it again.
        fitAsked = entry.asked;
        set({ fit: entry.picture });
      }
      get().update({ size });
    },
    update: (patch) => {
      const settings = { ...get().settings, ...patch };
      write(SAVED, settings);
      const nothingToFit = previewTargets(settings).length === 0;
      if (nothingToFit && get().compareOn) {
        stopFit();
        set({ compareOn: false });
      }
      // A view that no longer applies goes away, so the picture falls back to the art.
      const view = get().view;
      const gone = (view === "plate" && !settings.makePlate) || (view === "fit" && nothingToFit);
      set({ settings, view: gone ? "vector" : view });
      stale();
      refresh();
    },
    setOutput: (output) => get().update({ output, ...filesFor(output) }),
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
      const size = readSize(bitmap.width, bitmap.height);
      const imageNote =
        size.width < bitmap.width
          ? `Read at ${size.width} x ${size.height} px, scaled down from ${bitmap.width} x ${bitmap.height} px. Phones and tablets cannot read a larger image, and the same size is used everywhere so every device makes the same files.`
          : null;
      const surface = drawingSurface(size.width, size.height);
      surface.context.imageSmoothingQuality = "high";
      surface.context.drawImage(bitmap, 0, 0, size.width, size.height);
      const pixels = surface.context.getImageData(0, 0, size.width, size.height);
      const image: ImageData2 = { data: pixels.data, width: size.width, height: size.height };
      bitmap.close();
      const old = get().imageUrl;
      if (old) URL.revokeObjectURL(old);
      set({
        image,
        imageUrl: URL.createObjectURL(file),
        title: name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "artwork",
        imageNote,
        crop: null,
        preview: null,
        previewError: null,
        palette: [],
        paletteEdited: false,
        view: "source",
        fit: null,
        fitError: null,
        shownNozzle: null,
        compareOn: false,
        compare: [],
      });
      stopFit();
      fitAsked = null;
      stale();
      await suggest(image, null);
      refresh(0);
    },
    clearImage: () => {
      cancel("preview");
      stopFit();
      fitAsked = null;
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
        imageNote: null,
        fit: null,
        fitError: null,
        shownNozzle: null,
        compareOn: false,
        compare: [],
      });
    },
    exportFiles: async () => {
      const state = get();
      if (!state.image) return;
      stopFit(); // Two runs at the files' grid would need twice the memory.
      set({ exportBusy: true, exportError: null, result: null, exportStep: { message: "Starting", done: 0 } });
      try {
        const result = await run<ExportResult>(
          "export",
          { op: "export", image: state.image, request: exportRequest(state) },
          (message, done) => set({ exportStep: { message, done } }),
        );
        set({ result, exportBusy: false, exportStep: null });
        syncFit();
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

const TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  dxf: "image/vnd.dxf",
  "3mf": "model/3mf",
  zip: "application/zip",
};

/** A file to hand to the share sheet, or null where the device cannot share it. */
export function shareable(name: string, bytes: Uint8Array): File | null {
  if (typeof navigator.canShare !== "function") return null;
  const type = TYPES[name.slice(name.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
  const file = new File([bytes as BlobPart], name, { type });
  return navigator.canShare({ files: [file] }) ? file : null;
}

/**
 * The share sheet, which on an iPad sends the file straight to Affinity, Files or another app, where a download from a
 * home screen app can be awkward. Closing the sheet is not a failure; anything else saves the file as a download.
 */
export async function share(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    download(file.name, new Uint8Array(await file.arrayBuffer()), file.type);
  }
}

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
