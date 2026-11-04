/** R12 DXF. Every CAD importer reads POLYLINE, and each curve is written exactly as given. */
import { MM_PER_INCH, type Curve } from "@png2cad/core";

export type DxfUnits = "in" | "mm";

/** Write curves given in millimeters. Inches suit Onshape, which still asks but defaults to them. */
export function writeDxf(curves: Curve[], units: DxfUnits = "in", layer = "0"): string {
  const k = units === "in" ? 1 / MM_PER_INCH : 1;
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const c of curves) {
    for (const [x, y] of c.points) {
      loX = Math.min(loX, x * k);
      loY = Math.min(loY, y * k);
      hiX = Math.max(hiX, x * k);
      hiY = Math.max(hiY, y * k);
    }
  }
  const digits = units === "in" ? 5 : 4;
  const out = [
    ...["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009"],
    ...["9", "$INSUNITS", "70", units === "in" ? "1" : "4"],
    ...["9", "$EXTMIN", "10", loX.toFixed(4), "20", loY.toFixed(4)],
    ...["9", "$EXTMAX", "10", hiX.toFixed(4), "20", hiY.toFixed(4)],
    ...["0", "ENDSEC", "0", "SECTION", "2", "ENTITIES"],
  ];
  for (const c of curves) {
    out.push("0", "POLYLINE", "8", layer, "66", "1", "70", c.closed ? "1" : "0", "10", "0", "20", "0", "30", "0");
    for (const [x, y] of c.points) {
      out.push("0", "VERTEX", "8", layer, "10", (x * k).toFixed(digits), "20", (y * k).toFixed(digits), "30", "0");
    }
    out.push("0", "SEQEND", "8", layer);
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\r\n") + "\r\n";
}
