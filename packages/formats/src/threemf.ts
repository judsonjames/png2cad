/**
 * 3MF plates: one object made of named parts, each tagged with a display color and assigned a filament, the convention
 * Bambu Studio and Orca read. With a project template the file is also a Bambu Studio project, so it opens with its
 * printer, process and one filament per part. Without one it is plain 3MF: Bambu Studio 2.8.2 and later load only the
 * geometry through File > Open, and File > Import adds the filament slots.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { partBounds, type Part } from "./mesh.ts";
import { BAMBU_FILAMENT_KEYS } from "./bambuKeys.ts";

const NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
const MAT = "http://schemas.microsoft.com/3dmanufacturing/material/2015/02";

type Settings = Record<string, unknown>;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hex(c: [number, number, number]): string {
  return c
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export interface BambuTemplate {
  settings: Settings;
  printer: string;
  nozzle: string;
  process: string;
  filament: string;
}

/** Read the project settings out of a .3mf saved by Bambu Studio. */
export function readBambuTemplate(bytes: Uint8Array): BambuTemplate {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === "Metadata/project_settings.config" });
  } catch {
    throw new Error("That file is not a 3MF. Save a project from Bambu Studio and choose that file.");
  }
  const raw = files["Metadata/project_settings.config"];
  if (!raw) throw new Error("That 3MF holds no project settings. Save it from Bambu Studio with File > Save Project.");
  const settings = JSON.parse(new TextDecoder().decode(raw)) as Settings;
  if (!settings.printer_model && !settings.nozzle_diameter) {
    throw new Error("Those project settings name no printer. Save the project from Bambu Studio again.");
  }
  const first = (k: string): string => {
    const v = settings[k];
    return String(Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
  };
  return {
    settings,
    printer: first("printer_model") || first("printer_settings_id"),
    nozzle: first("nozzle_diameter"),
    process: first("print_settings_id"),
    filament: first("filament_settings_id"),
  };
}

/** A template's settings with one filament per color. The first filament's values are repeated for each. */
export function projectFromTemplate(t: BambuTemplate, colors: string[]): Settings {
  const s: Settings = structuredClone(t.settings);
  const was = Array.isArray(s.filament_colour) ? s.filament_colour.length : 1;
  const n = colors.length;
  for (const key of BAMBU_FILAMENT_KEYS) {
    const v = s[key];
    if (!Array.isArray(v)) continue;
    const per = Math.max(1, Math.floor(v.length / Math.max(was, 1)));
    const one = v.slice(0, per);
    s[key] = Array.from({ length: n }, () => one).flat();
  }
  const variants = Array.isArray(s.filament_extruder_variant) ? s.filament_extruder_variant.length / n : 1;
  const group = Array.isArray(s.inherits_group) ? (s.inherits_group as string[]) : [];
  const process = group.length ? group[0] : "";
  const machine = group.length ? group[group.length - 1] : "";
  const filament = group.length > 1 ? group[1] : "";
  s.filament_colour = colors.map((c) => c.toUpperCase());
  if (Array.isArray(s.filament_settings_id))
    s.filament_settings_id = colors.map(() => (s.filament_settings_id as string[])[0]);
  if (Array.isArray(s.filament_ids)) s.filament_ids = colors.map(() => (s.filament_ids as string[])[0]);
  if (Array.isArray(s.filament_self_index)) {
    s.filament_self_index = colors.flatMap((_, i) =>
      Array.from({ length: Math.max(1, variants) }, () => String(i + 1)),
    );
  }
  if (Array.isArray(s.filament_map)) s.filament_map = colors.map(() => "1");
  s.inherits_group = [process, ...colors.map(() => filament), machine];
  s.different_settings_to_system = Array.from({ length: n + 2 }, () => "");
  return s;
}

export interface ThreeMfOptions {
  title?: string;
  /** Bambu project settings, from projectFromTemplate. */
  project?: Settings;
  /** Written into the Application tag; keep it at or below the installed Bambu Studio. */
  bambuVersion?: string;
}

function bedCenter(project: Settings | undefined): [number, number] | null {
  if (!project) return null;
  const area = project.printable_area;
  if (!Array.isArray(area) || !area.length) return [128, 128];
  const pts = area.map((xy) => String(xy).split("x").map(Number));
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** The package bytes. The same input gives the same bytes: ZIP times are fixed. */
export function writeThreeMf(parts: Part[], o: ThreeMfOptions = {}): Uint8Array {
  const title = escapeXml(o.title ?? "part");
  const version = o.bambuVersion ?? String(o.project?.version ?? "02.08.00.00");
  const app = o.project ? `BambuStudio-${version}` : "png2cad";
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<model unit="millimeter" xml:lang="en-US" xmlns="${NS}" xmlns:m="${MAT}">`,
    ` <metadata name="Title">${title}</metadata>`,
    ` <metadata name="Application">${app}</metadata>`,
  ];
  if (o.project) out.push(` <metadata name="BambuStudio:3mfVersion">1</metadata>`);
  out.push(" <resources>", `  <basematerials id="1">`);
  for (const p of parts) out.push(`   <base name="${escapeXml(p.name)}" displaycolor="#${hex(p.color)}FF"/>`);
  out.push("  </basematerials>");
  parts.forEach((p, k) => {
    out.push(`  <object id="${k + 2}" type="model" name="${escapeXml(p.name)}" pid="1" pindex="${k}">`, "   <mesh>");
    out.push("    <vertices>");
    for (let i = 0; i < p.vertices.length; i += 3) {
      out.push(
        `     <vertex x="${p.vertices[i].toFixed(6)}" y="${p.vertices[i + 1].toFixed(6)}" z="${p.vertices[i + 2].toFixed(6)}"/>`,
      );
    }
    out.push("    </vertices>", "    <triangles>");
    for (let i = 0; i < p.triangles.length; i += 3) {
      out.push(`     <triangle v1="${p.triangles[i]}" v2="${p.triangles[i + 1]}" v3="${p.triangles[i + 2]}"/>`);
    }
    out.push("    </triangles>", "   </mesh>", "  </object>");
  });
  const parent = parts.length + 2;
  out.push(`  <object id="${parent}" type="model" name="${title}">`, "   <components>");
  parts.forEach((_, k) => out.push(`    <component objectid="${k + 2}"/>`));
  out.push("   </components>", "  </object>", " </resources>", " <build>");
  const center = bedCenter(o.project);
  if (center) {
    const { lo, hi } = partBounds(parts);
    const tx = center[0] - (lo[0] + hi[0]) / 2;
    const ty = center[1] - (lo[1] + hi[1]) / 2;
    out.push(
      `  <item objectid="${parent}" transform="1 0 0 0 1 0 0 0 1 ${tx.toFixed(6)} ${ty.toFixed(6)} ${(-lo[2]).toFixed(6)}" printable="1"/>`,
    );
  } else {
    out.push(`  <item objectid="${parent}"/>`);
  }
  out.push(" </build>", "</model>");

  const ident = "1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1";
  const cfg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    "<config>",
    `  <object id="${parent}">`,
    `    <metadata key="name" value="${title}"/>`,
    `    <metadata key="extruder" value="1"/>`,
  ];
  parts.forEach((p, k) => {
    cfg.push(
      `    <part id="${k + 2}" subtype="normal_part">`,
      `      <metadata key="name" value="${escapeXml(p.name)}"/>`,
      `      <metadata key="matrix" value="${ident}"/>`,
      `      <metadata key="extruder" value="${k + 1}"/>`,
      "    </part>",
    );
  });
  cfg.push("  </object>", "</config>");

  const when = { mtime: new Date(Date.UTC(2020, 0, 1)) };
  const files: Zippable = {
    "[Content_Types].xml": [
      strToU8(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n`,
      ),
      when,
    ],
    "_rels/.rels": [
      strToU8(
        `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n`,
      ),
      when,
    ],
    "3D/3dmodel.model": [strToU8(`${out.join("\n")}\n`), when],
    "Metadata/model_settings.config": [strToU8(`${cfg.join("\n")}\n`), when],
  };
  if (o.project) {
    const project = { ...o.project, version };
    files["Metadata/project_settings.config"] = [strToU8(`${JSON.stringify(project, null, 4)}\n`), when];
  }
  return zipSync(files, { level: 6 });
}
