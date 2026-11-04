import { boundaryChains, fitChains, type LabelMap } from "@png2cad/core";
import { strFromU8, unzipSync } from "fflate";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildParts,
  projectFromTemplate,
  readBambuTemplate,
  readDxf,
  runJob,
  verifyDxf,
  verifySvg,
  verifyThreeMf,
  writeThreeMf,
  type BambuTemplate,
  type JobRequest,
} from "../src/index.ts";

let wasm: ManifoldToplevel;
beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** A disc of one color holding a square of another, with a hole through to the background. */
function badge(): LabelMap {
  const w = 500;
  const h = 500;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 250, y - 250);
      if (d > 230) continue;
      data[y * w + x] = Math.abs(x - 250) < 90 && Math.abs(y - 250) < 90 ? 2 : 1;
      if (Math.hypot(x - 250, y - 120) < 30) data[y * w + x] = 0;
    }
  }
  return {
    data,
    width: w,
    height: h,
    cellMm: 0.05,
    names: ["background", "blue", "red"],
    colors: [
      [255, 255, 255],
      [20, 40, 120],
      [200, 30, 30],
    ],
  };
}

const request: JobRequest = {
  title: "badge",
  widthMm: 25,
  nozzles: [0.4],
  svg: { source: "art" },
  dxf: { units: "in", perColor: true },
  plate: { style: "inset", materials: 2 },
};

const dec = new TextDecoder();

describe("a whole job", () => {
  it("makes every file, and every verifier passes it", () => {
    const r = runJob(badge(), request, wasm);
    expect(r.files.map((f) => f.name).sort()).toEqual([
      "badge.svg",
      "badge_n0.4.3mf",
      "badge_n0.4.dxf",
      "badge_n0.4_blue.dxf",
      "badge_n0.4_red.dxf",
    ]);
    expect(r.findings.filter((f) => f.severity === "fault")).toEqual([]);
  });

  it("gives the same bytes every time", () => {
    const a = runJob(badge(), request, wasm);
    const b = runJob(badge(), request, wasm);
    a.files.forEach((f, i) => expect(Buffer.from(f.bytes).equals(Buffer.from(b.files[i].bytes))).toBe(true));
  });

  it("writes DXF in the units asked for", () => {
    const pick = (units: "in" | "mm") => {
      const r = runJob(
        badge(),
        { ...request, svg: undefined, plate: undefined, dxf: { units, perColor: false } },
        wasm,
      );
      const curves = readDxf(dec.decode(r.files[0].bytes));
      return Math.max(...curves.flatMap((c) => c.points.map((p) => p[0])));
    };
    expect(pick("mm") / pick("in")).toBeCloseTo(25.4, 1);
  });
});

describe("verifiers catch damage", () => {
  const made = () => runJob(badge(), request, wasm);

  it("SVG: a stroke, an open path and a moved size", () => {
    const text = dec.decode(made().files.find((f) => f.kind === "svg")?.bytes);
    expect(verifySvg(text).every((f) => f.severity === "pass")).toBe(true);
    const bad = (t: string) => verifySvg(t).some((f) => f.severity === "fault");
    expect(bad(text.replace('fill-rule="evenodd"', 'fill-rule="evenodd" stroke="#000000"'))).toBe(true);
    expect(bad(text.replace("Z", ""))).toBe(true);
    expect(bad(text.replace(/viewBox="0 0 ([\d.]+)/, 'viewBox="0 0 9'))).toBe(true);
  });

  it("DXF: a loose end and a crossing", () => {
    const line = (pts: number[][], closed: number) => {
      const out = ["0", "POLYLINE", "8", "0", "66", "1", "70", String(closed), "10", "0", "20", "0", "30", "0"];
      for (const [x, y] of pts) out.push("0", "VERTEX", "8", "0", "10", String(x), "20", String(y), "30", "0");
      return [...out, "0", "SEQEND", "8", "0"];
    };
    const file = (...c: string[][]) => [...c.flat(), "0", "EOF"].join("\n");
    const faults = (t: string) =>
      verifyDxf(t)
        .filter((f) => f.severity === "fault")
        .map((f) => f.code);
    expect(
      faults(
        file(
          line(
            [
              [0, 0],
              [1, 1],
            ],
            0,
          ),
        ),
      ),
    ).toContain("dxf.loose");
    const square = line(
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      1,
    );
    expect(
      faults(
        file(
          square,
          line(
            [
              [1, -1],
              [1, 3],
              [3, 3],
              [3, -1],
            ],
            1,
          ),
        ),
      ),
    ).toContain("dxf.crossing");
    expect(faults(file(square))).toEqual([]);
  });

  it("3MF: a missing triangle and a wrong material count", () => {
    const bytes = made().files.find((f) => f.kind === "3mf")?.bytes as Uint8Array;
    expect(verifyThreeMf(bytes, 2).findings.every((f) => f.severity === "pass")).toBe(true);
    expect(verifyThreeMf(bytes, 3).findings.some((f) => f.code === "3mf.materials")).toBe(true);
    const parts = buildParts(wasm, badge(), boundaryChains(badge()));
    parts[0].triangles = parts[0].triangles.slice(3);
    expect(verifyThreeMf(writeThreeMf(parts)).findings.some((f) => f.code === "3mf.watertight")).toBe(true);
  });
});

describe("plates", () => {
  const volume = (bytes: Uint8Array) => verifyThreeMf(bytes).parts;

  it("makes the inlaid top flush: parts fill the footprint exactly", () => {
    const map = badge();
    const parts = buildParts(wasm, map, boundaryChains(map), { style: "inset", baseMm: 1, insetMm: 2 });
    expect(parts.map((p) => p.name)).toEqual(["blue", "red"]);
    const top = Math.max(...parts.flatMap((p) => [...p.vertices].filter((_, i) => i % 3 === 2)));
    expect(top).toBeCloseTo(3, 4);
  });

  it("gives one-color art a separate plate", () => {
    const map = badge();
    const one: LabelMap = { ...map, data: map.data.map((v) => (v ? 1 : 0)), names: ["background", "blue"] };
    const parts = buildParts(wasm, one, boundaryChains(one), { style: "inset" });
    expect(parts.map((p) => p.name)).toEqual(["base", "blue"]);
  });

  it("runs repeatedly on one kernel", () => {
    const map = badge();
    const chains = boundaryChains(map);
    for (let i = 0; i < 3; i++) buildParts(wasm, map, chains, { style: "relief" });
    expect(volume(writeThreeMf(buildParts(wasm, map, chains, { style: "flat" }))).length).toBe(2);
  });
});

describe("Bambu templates", () => {
  const template: BambuTemplate = {
    settings: {
      printer_model: "Test Printer",
      version: "02.08.00.05",
      printable_area: ["0x0", "200x0", "200x200", "0x200"],
      filament_colour: ["#111111"],
      filament_settings_id: ["Test PLA"],
      filament_type: ["PLA"],
      nozzle_temperature: ["220"],
      nozzle_diameter: ["0.4"],
      inherits_group: ["process", "Test PLA", "machine"],
    },
    printer: "Test Printer",
    nozzle: "0.4",
    process: "process",
    filament: "Test PLA",
  };

  it("repeats filament settings once per color, and leaves the rest alone", () => {
    const p = projectFromTemplate(template, ["#ff0000", "#00ff00", "#0000ff"]);
    expect(p.filament_colour).toEqual(["#FF0000", "#00FF00", "#0000FF"]);
    expect(p.filament_type).toEqual(["PLA", "PLA", "PLA"]);
    expect(p.nozzle_temperature).toEqual(["220", "220", "220"]);
    expect(p.nozzle_diameter).toEqual(["0.4"]);
    expect(p.inherits_group).toEqual(["process", "Test PLA", "Test PLA", "Test PLA", "machine"]);
  });

  it("round-trips: a plate made from a template works as a template", () => {
    const map = badge();
    const parts = buildParts(wasm, map, boundaryChains(map));
    const bytes = writeThreeMf(parts, { title: "t", project: projectFromTemplate(template, ["#111111", "#222222"]) });
    const files = unzipSync(bytes);
    expect(strFromU8(files["3D/3dmodel.model"])).toContain("BambuStudio-02.08.00.05");
    expect(strFromU8(files["3D/3dmodel.model"])).toContain('transform="1 0 0 0 1 0 0 0 1 ');
    expect(readBambuTemplate(bytes).printer).toBe("Test Printer");
  });

  it("explains a file that is not a Bambu project", () => {
    expect(() => readBambuTemplate(new Uint8Array([1, 2, 3]))).toThrow(/not a 3MF/);
    const map = badge();
    const plain = writeThreeMf(buildParts(wasm, map, boundaryChains(map)));
    expect(() => readBambuTemplate(plain)).toThrow(/no project settings/);
  });
});

describe("curve fitting", () => {
  it("fits fewer nodes than the trace has points", () => {
    const map = badge();
    const chains = boundaryChains(map);
    const nodes = fitChains(chains, map.cellMm).reduce((n, c) => n + c.length, 0);
    const points = chains.reduce((n, c) => n + c.points.length, 0);
    expect(nodes).toBeLessThan(points / 8);
  });
});
