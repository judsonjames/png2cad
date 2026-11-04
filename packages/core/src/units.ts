/** Lengths are millimeters everywhere inside. Convert only when reading input and writing files. */
export const MM_PER_INCH = 25.4;

/** A length with an optional unit, in millimeters: 5in, 5", 127mm, 12.7cm. A bare number uses defaultUnit. */
export function parseLength(text: string, defaultUnit: "mm" | "in" = "mm"): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  const m = /^([0-9]*\.?[0-9]+)(mm|cm|in|")?$/.exec(t);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2] ?? defaultUnit;
  return unit === "mm" ? value : unit === "cm" ? value * 10 : value * MM_PER_INCH;
}

/** Layer height and inset depth for a nozzle: layers are half the nozzle unless given. */
export function layerHeights(nozzleMm: number, layerMm?: number, insetLayers = 10, insetMm?: number) {
  const layer = layerMm || nozzleMm / 2;
  return { layer, depth: insetMm || insetLayers * layer };
}
