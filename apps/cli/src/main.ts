#!/usr/bin/env node
/** Command-line entry on the same engine as the web app, for tests and agents. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { parseLength, suggestTrace, traceImage, type Box, type Rgb } from "@png2cad/core";
import { readBambuTemplate, runJob, type JobRequest } from "@png2cad/formats";
import Module from "manifold-3d";
import { PNG } from "pngjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: "string", default: "mask" },
    width: { type: "string" },
    height: { type: "string" },
    nozzle: { type: "string", default: "0.4" },
    out: { type: "string", default: "out" },
    svg: { type: "boolean", default: false },
    dxf: { type: "boolean", default: false },
    "dxf-units": { type: "string", default: "mm" },
    "3mf": { type: "boolean", default: false },
    "per-color": { type: "boolean", default: false },
    palette: { type: "string" },
    colors: { type: "string" },
    style: { type: "string", default: "inset" },
    materials: { type: "string" },
    template: { type: "string" },
    "max-cells": { type: "string" },
    "min-cell-mm": { type: "string" },
    "keep-enclosed": { type: "boolean", default: false },
    sharpen: { type: "string" },
    "svg-line": { type: "string" },
    crop: { type: "string" },
  },
});

const file = positionals[0];
if (!file) {
  console.error(
    "usage: png2cad image.png --width 127mm [--mode mask|colors] [--svg] [--dxf] [--3mf] [--nozzle 0.2,0.4]",
  );
  process.exit(2);
}
const png = PNG.sync.read(readFileSync(file));
const hex = (h: string): Rgb => {
  const t = h.trim().replace("#", "");
  const s = t.length === 3 ? [...t].map((c) => c + c).join("") : t;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as Rgb;
};
const widthMm = values.width ? (parseLength(values.width) ?? undefined) : undefined;
const heightMm = values.height ? (parseLength(values.height) ?? undefined) : undefined;
const started = Date.now();
const image = { data: png.data, width: png.width, height: png.height };
const numbers = values.crop?.split(",").map(Number);
const crop: Box | undefined = numbers && { x0: numbers[0], y0: numbers[1], x1: numbers[2], y1: numbers[3] };
const auto = values.mode === "auto" ? suggestTrace(image, crop) : null;
const map = traceImage(image, {
  mode: auto?.mode ?? (values.mode as "mask" | "colors"),
  widthMm,
  heightMm,
  crop,
  palette: auto?.mode === "colors" ? auto.palette : values.palette ? values.palette.split(",").map(hex) : undefined,
  background: auto?.mode === "mask" ? auto.palette[0] : undefined,
  foreground: auto?.mode === "mask" ? auto.palette[1] : undefined,
  colorCount: values.colors ? Number(values.colors) : undefined,
  keepEnclosed: values["keep-enclosed"],
  sharpen: values.sharpen ? Number(values.sharpen) : undefined,
  maxCells: values["max-cells"] ? Number(values["max-cells"]) : undefined,
  minCellMm: values["min-cell-mm"] ? Number(values["min-cell-mm"]) : undefined,
});
console.log(`traced ${map.width} x ${map.height} cells of ${map.cellMm.toFixed(4)} mm in ${Date.now() - started} ms`);
const wasm = await Module();
wasm.setup();
const title = basename(file, extname(file)).replace(/\s+/g, "_");
const request: JobRequest = {
  title,
  widthMm,
  heightMm,
  nozzles: values.nozzle.split(",").map(Number),
  svg: values["svg-line"]
    ? { source: "line", lineMm: Number(values["svg-line"]) }
    : values.svg
      ? { source: "art" }
      : undefined,
  dxf: values.dxf ? { units: values["dxf-units"] as "mm" | "in", perColor: values["per-color"] } : undefined,
  plate: values["3mf"]
    ? {
        style: values.style as "inset" | "relief" | "flat",
        materials: values.materials ? Number(values.materials) : undefined,
        template: values.template ? readBambuTemplate(readFileSync(values.template)) : undefined,
      }
    : undefined,
};
const result = runJob(map, request, wasm, (message) =>
  console.log(`${((Date.now() - started) / 1000).toFixed(1)} s ${message}`),
);
mkdirSync(values.out, { recursive: true });
for (const f of result.files) {
  writeFileSync(join(values.out, f.name), f.bytes);
  console.log(`wrote ${f.name} (${(f.bytes.length / 1024).toFixed(0)} KB)`);
}
for (const f of result.findings) console.log(`${f.severity.toUpperCase().padEnd(7)} ${f.message}`);
const failed = result.findings.some((f) => f.severity === "fault");
console.log("RESULT:", failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
