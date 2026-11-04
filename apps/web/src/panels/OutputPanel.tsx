import { readBambuTemplate } from "@png2cad/formats";
import {
  Banner,
  Button,
  Checkbox,
  Disclosure,
  Field,
  NumberInput,
  Section,
  Select,
  Switch,
  ToggleGroup,
} from "@png2cad/ui/components";
import { useRef, useState } from "react";
import { useApp } from "../store";

const NOZZLES = [0.2, 0.4, 0.6, 0.8];

/** Which files to make, and how. */
export function OutputPanel() {
  const s = useApp((st) => st.settings);
  const update = useApp((st) => st.update);
  const template = useApp((st) => st.template);
  const setTemplate = useApp((st) => st.setTemplate);
  const input = useRef<HTMLInputElement>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const needsNozzle = s.makeDxf || s.makePlate || (s.makeSvg && s.svgFitted);
  const toggle = (n: number) => {
    const next = s.nozzles.includes(n) ? s.nozzles.filter((x) => x !== n) : [...s.nozzles, n].sort((a, b) => a - b);
    if (next.length) update({ nozzles: next });
  };
  const pickTemplate = async (file: File) => {
    try {
      setTemplate(readBambuTemplate(new Uint8Array(await file.arrayBuffer())));
      setTemplateError(null);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Section title="Files">
      <div className="app-output">
        <Switch
          label="SVG"
          checked={s.makeSvg}
          onChange={(makeSvg) => update({ makeSvg })}
          info="Filled shapes for Affinity, Illustrator and product printing. One layer per color, in real size."
        />
        {s.makeSvg && (
          <div className="app-suboptions">
            <Checkbox
              label="Fit Lines to the Nozzle"
              hint="Leave off for artwork. Turn on only for a file going to a slicer."
              checked={s.svgFitted}
              onChange={(svgFitted) => update({ svgFitted })}
            />
            <Checkbox
              label="Add a Background"
              checked={s.backdrop !== null}
              onChange={(on) => update({ backdrop: on ? "#ffffff" : null })}
            />
            {s.backdrop !== null && (
              <input
                type="color"
                aria-label="Background Color"
                value={s.backdrop}
                onChange={(e) => update({ backdrop: e.target.value })}
              />
            )}
          </div>
        )}
        <Switch
          label="DXF"
          checked={s.makeDxf}
          onChange={(makeDxf) => update({ makeDxf })}
          info="R12 polylines for Onshape and other CAD. Every area selects as one region. In Onshape: Sketch, Insert DXF/DWG."
        />
        {s.makeDxf && (
          <div className="app-suboptions">
            <Field label="DXF Units">
              <Select
                value={s.dxfUnits}
                onChange={(dxfUnits) => update({ dxfUnits })}
                options={[
                  { value: "in", label: "Inches" },
                  { value: "mm", label: "Millimeters" },
                ]}
              />
            </Field>
            <Checkbox
              label="Also Write One File per Color"
              hint="For one sketch per color."
              checked={s.perColor}
              onChange={(perColor) => update({ perColor })}
            />
          </div>
        )}
        <Switch
          label="3MF Plate"
          checked={s.makePlate}
          onChange={(makePlate) => update({ makePlate })}
          info="A ready-to-slice plate for Bambu Studio and Orca Slicer, each color assigned its own filament."
        />
        {s.makePlate && (
          <div className="app-suboptions">
            <ToggleGroup
              label="Plate Style"
              value={s.style}
              onChange={(style) => update({ style })}
              options={[
                { value: "inset", label: "Inlaid" },
                { value: "relief", label: "Raised" },
                { value: "flat", label: "Flat Tile" },
              ]}
            />
            {s.style === "inset" && (
              <Field
                label="Inlay Depth"
                info="Layers deep the design goes. Layers are half the nozzle, so 10 layers at a 0.4 mm nozzle is 2 mm."
              >
                <NumberInput
                  unit="layers"
                  digits={0}
                  min={1}
                  value={s.insetLayers}
                  onChange={(v) => v && update({ insetLayers: Math.round(v) })}
                />
              </Field>
            )}
            {s.style === "relief" && (
              <Field label="Raised Height">
                <NumberInput unit="mm" min={0.1} value={s.reliefMm} onChange={(v) => v && update({ reliefMm: v })} />
              </Field>
            )}
            {s.style !== "flat" && (
              <Field label="Base Thickness" info="The solid plate under the design, rounded to whole layers.">
                <NumberInput unit="mm" min={0.2} value={s.baseMm} onChange={(v) => v && update({ baseMm: v })} />
              </Field>
            )}
            <div className="app-template">
              <span className="p2c-field-note">
                {template
                  ? `Bambu project: ${template.printer}, ${template.nozzle} mm nozzle`
                  : "Plain 3MF. Open it in Bambu Studio with File > Import."}
              </span>
              <div className="app-row">
                <Button onClick={() => input.current?.click()}>
                  {template ? "Replace Bambu Template" : "Add Bambu Template"}
                </Button>
                {template && (
                  <Button variant="quiet" onClick={() => setTemplate(null)}>
                    Remove Template
                  </Button>
                )}
              </div>
              <span className="p2c-help">
                Save any project from Bambu Studio and choose that .3mf. Plates then open with your printer, process and
                one filament per color.
              </span>
              {templateError && <Banner kind="danger">{templateError}</Banner>}
              <input
                ref={input}
                className="app-hidden"
                type="file"
                accept=".3mf"
                aria-label="Bambu Project Template"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void pickTemplate(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        )}
      </div>
      {needsNozzle && (
        <>
          <Field
            label="Nozzles (mm)"
            info="One set of files per nozzle. Lines and gaps are fitted so each nozzle can print them."
          >
            <div className="p2c-toggle-group app-nozzles" role="group" aria-label="Nozzles in Millimeters">
              {NOZZLES.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="p2c-toggle"
                  aria-pressed={s.nozzles.includes(n)}
                  onClick={() => toggle(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Disclosure summary="Nozzle Fit Details">
            <Field
              label="Smallest Line"
              info="Times the nozzle. Lines at exactly 1.0 left gaps in slices, so the default is 1.05. Use 1.5 to 2 for sturdier detail."
            >
              <NumberInput
                unit="x"
                min={0.5}
                value={s.featureFactor}
                onChange={(v) => v && update({ featureFactor: v })}
              />
            </Field>
            <Field label="Smallest Gap" info="Times the nozzle. Narrower gaps are closed.">
              <NumberInput unit="x" min={0.5} value={s.gapFactor} onChange={(v) => v && update({ gapFactor: v })} />
            </Field>
          </Disclosure>
        </>
      )}
    </Section>
  );
}
