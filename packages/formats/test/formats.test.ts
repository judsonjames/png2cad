import { boundaryChains, fitChains, type Cubic, type LabelMap, type Point } from "@png2cad/core";
import { strFromU8, unzipSync } from "fflate";
import Module, { type ManifoldToplevel } from "manifold-3d";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildParts,
  fitAtSize,
  LINE_FIT,
  outlineSvg,
  projectFromTemplate,
  readBambuTemplate,
  readDxf,
  runJob,
  verifyDxf,
  verifySvg,
  verifyThreeMf,
  writeSvg,
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

describe("size", () => {
  const dxfSpan = (bytes: Uint8Array) => {
    const pts = readDxf(dec.decode(bytes)).flatMap((c) => c.points);
    const span = (i: 0 | 1) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]));
    return {
      width: span(0),
      height: span(1),
      lo: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))],
    };
  };
  const svgWidth = (bytes: Uint8Array) => Number(/width="([\d.]+)mm"/.exec(dec.decode(bytes))?.[1]);
  const plateWidth = (bytes: Uint8Array) => {
    const model = strFromU8(unzipSync(bytes)["3D/3dmodel.model"]);
    const xs = [...model.matchAll(/<vertex x="([^"]+)"/g)].map((m) => Number(m[1]));
    return Math.max(...xs) - Math.min(...xs);
  };
  const job = (units: "mm" | "in", perColor = false): JobRequest => ({
    ...request,
    dxf: { units, perColor },
    plate: { style: "flat" },
  });

  it("a size in mm comes out as that number in every file", () => {
    const r = runJob(badge(), job("mm"), wasm);
    const by = (kind: string) => r.files.find((f) => f.kind === kind)?.bytes as Uint8Array;
    expect(svgWidth(by("svg"))).toBeCloseTo(25, 1);
    expect(dxfSpan(by("dxf")).width).toBeGreaterThan(24.9);
    expect(dxfSpan(by("dxf")).width).toBeLessThan(25.05);
    expect(plateWidth(by("3mf"))).toBeGreaterThan(24.9);
    expect(plateWidth(by("3mf"))).toBeLessThan(25.05);
    expect(r.findings.filter((f) => f.severity === "fault")).toEqual([]);
  });

  it("states each file's real size, in that file's units", () => {
    const pick = (units: "mm" | "in") =>
      runJob(badge(), job(units), wasm).files.find((f) => f.kind === "dxf")?.sizeText;
    expect(pick("mm")).toMatch(/^25\.0 x [\d.]+ mm \(0\.98 x [\d.]+ in\)$/);
    expect(pick("in")).toMatch(/^0\.98 x [\d.]+ in \(25\.0 x [\d.]+ mm\)$/);
  });

  it("a height can set the size", () => {
    const r = runJob(badge(), { ...job("mm"), widthMm: undefined, heightMm: 30 }, wasm);
    expect(dxfSpan(r.files.find((f) => f.kind === "dxf")?.bytes as Uint8Array).height).toBeCloseTo(30, 0);
  });

  it("per-color DXFs line up with the main file", () => {
    const r = runJob(badge(), { ...job("mm", true), svg: undefined, plate: undefined }, wasm);
    const main = dxfSpan(r.files.find((f) => f.name === "badge_n0.4.dxf")?.bytes as Uint8Array);
    const red = dxfSpan(r.files.find((f) => f.name === "badge_n0.4_red.dxf")?.bytes as Uint8Array);
    // The red square sits inside the disc, so it must not start at the origin.
    expect(main.lo[0]).toBeCloseTo(0, 3);
    expect(red.lo[0]).toBeGreaterThan(5);
    expect(red.lo[1]).toBeGreaterThan(5);
  });

  it("a file that misses the size fails its check, in either direction", () => {
    const bytes = runJob(badge(), { ...job("mm"), svg: undefined, plate: undefined }, wasm).files[0].bytes;
    const text = dec.decode(bytes);
    const code = (w: number) => verifyDxf(text, w).find((f) => f.code === "dxf.size")?.severity;
    expect(code(25)).toBe("pass");
    expect(code(100)).toBe("fault");
    expect(code(5)).toBe("fault");
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

describe("SVG page", () => {
  /** A circle whose curves join at 45 degrees, so no end point sits at its left, right, top or bottom. */
  function circle(r: number): Cubic[] {
    const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
    const at = (a: number): Point => [r * Math.cos(a), r * Math.sin(a)];
    const out: Cubic[] = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const b = a + Math.PI / 2;
      const [p, q] = [at(a), at(b)];
      out.push([
        p,
        [p[0] - k * Math.sin(a), p[1] + k * Math.cos(a)],
        [q[0] + k * Math.sin(b), q[1] - k * Math.cos(b)],
        q,
      ]);
    }
    return out;
  }
  const page = () =>
    writeSvg([{ name: "disc", color: [0, 0, 0], areas: [{ outer: circle(10), holes: [] }] }], { widthMm: 40 });

  it("holds the whole curve, not just its end points", () => {
    const svg = page();
    expect(svg.widthMm).toBeCloseTo(40, 3);
    expect(svg.heightMm).toBeCloseTo(40, 3);
    expect(verifySvg(svg.text, 40).filter((f) => f.severity === "fault")).toEqual([]);
  });

  it("fails a file whose art runs past the page", () => {
    const small = page().text.replace(
      /width="[\d.]+mm" height="[\d.]+mm" viewBox="0 0 [\d.]+ [\d.]+"/,
      'width="36mm" height="36mm" viewBox="0 0 36 36"',
    );
    expect(verifySvg(small).map((f) => f.code)).toContain("svg.page");
    expect(verifySvg(small).find((f) => f.code === "svg.page")?.severity).toBe("fault");
  });
});

describe("SVG units", () => {
  const box = { title: "b", widthMm: 127, nozzles: [] } as unknown as JobRequest;

  it("states its size in inches when asked, and still checks out at the same real size", () => {
    const job = runJob(badge(), { ...box, svg: { source: "art", units: "in" } } as JobRequest, null);
    const svg = job.files[0];
    const text = strFromU8(svg.bytes);
    expect(text).toMatch(/<svg[^>]* width="5in" height="[\d.]+in"/);
    expect(svg.sizeText).toMatch(/^5\.00 x [\d.]+ in \(127\.0 x [\d.]+ mm\)$/);
    expect(verifySvg(text, 127).filter((f) => f.severity === "fault")).toEqual([]);
  });

  it("stays in millimeters by default, and shows inches beside them", () => {
    const job = runJob(badge(), { ...box, svg: { source: "art" } } as JobRequest, null);
    expect(strFromU8(job.files[0].bytes)).toMatch(/<svg[^>]* width="127(\.0+)?mm"/);
    expect(job.files[0].sizeText).toMatch(/^127\.0 x [\d.]+ mm \(5\.00 x [\d.]+ in\)$/);
  });

  it("fails an SVG whose stated inches disagree with its page", () => {
    const text = strFromU8(
      runJob(badge(), { ...box, svg: { source: "art", units: "in" } } as JobRequest, null).files[0].bytes,
    );
    const wrong = text.replace('width="5in"', 'width="4in"');
    expect(verifySvg(wrong).map((f) => f.code)).toContain("svg.viewbox");
  });
});

describe("smallest line", () => {
  /** A hairline beside a solid block. */
  function hairline(): LabelMap {
    const w = 600;
    const h = 200;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x > 20 && x < 580 && Math.abs(y - 60) < 2) data[y * w + x] = 1;
        if (x > 200 && x < 400 && y > 110 && y < 180) data[y * w + x] = 1;
      }
    }
    return {
      data,
      width: w,
      height: h,
      cellMm: 0.05,
      names: ["background", "ink"],
      colors: [
        [255, 255, 255],
        [0, 0, 0],
      ],
    };
  }

  it("thickens thin lines in the SVG, and only for this file", () => {
    const job = runJob(
      hairline(),
      { title: "h", widthMm: 28, nozzles: [], svg: { source: "line", lineMm: 0.5 } } as JobRequest,
      null,
    );
    expect(job.files.map((f) => f.name)).toEqual(["h_line0.5.svg"]);
    expect(job.findings.filter((f) => f.severity === "fault")).toEqual([]);
    expect(job.findings.some((f) => f.message.startsWith("0.5 mm lines: every line"))).toBe(true);
    const fitted = fitAtSize(hairline(), 0.5, LINE_FIT, { widthMm: 28 });
    const m = fitted.map;
    let thinnest = Infinity;
    for (let x = Math.round(m.width * 0.2); x < m.width * 0.8; x += 10) {
      let run = 0;
      for (let y = 0; y < m.height / 2; y++) if (m.data[y * m.width + x]) run++;
      thinnest = Math.min(thinnest, run);
    }
    expect(thinnest * m.cellMm).toBeGreaterThan(0.45);
  });
});

describe("export preview", () => {
  it("draws the same points as the DXF, at the same size", () => {
    const map = badge();
    const box = { widthMm: 60 };
    const job = runJob(
      map,
      { title: "badge", ...box, nozzles: [0.4], dxf: { units: "mm", perColor: false } } as JobRequest,
      null,
    );
    const dxf = job.files.find((f) => f.kind === "dxf");
    const curves = readDxf(strFromU8(dxf?.bytes as Uint8Array));
    const outline = outlineSvg(fitAtSize(map, 0.4, undefined, box).map);
    expect(outline.widthMm).toBeCloseTo(Math.max(...curves.flatMap((c) => c.points.map((p) => p[0]))), 3);
    const flipped = curves.flatMap((c) => c.points.map(([x, y]) => [x, outline.heightMm - y]));
    const shown = [...outline.text.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(shown.length).toBeGreaterThan(20);
    // Both ways: a shared edge is drawn once per color, so the counts differ but the points do not.
    const gap = (from: number[][], to: number[][]) =>
      Math.max(...from.map(([x, y]) => Math.min(...to.map(([a, b]) => Math.hypot(a - x, b - y)))));
    expect(gap(shown, flipped)).toBeLessThan(0.0005);
    expect(gap(flipped, shown)).toBeLessThan(0.0005);
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
