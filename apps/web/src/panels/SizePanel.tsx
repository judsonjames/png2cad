import { Field, NumberInput, Section, Select, ToggleGroup } from "@png2cad/ui/components";
import { useApp } from "../store";

/** Real-world size. One side is set; the other follows the art, so nothing is distorted. */
export function SizePanel() {
  const s = useApp((st) => st.settings);
  const update = useApp((st) => st.update);
  const preview = useApp((st) => st.preview);
  const other = s.sizeBy === "width" ? preview?.heightMm : preview?.widthMm;
  const follow =
    other === undefined ? "" : s.unit === "in" ? `${(other / 25.4).toFixed(2)} in` : `${other.toFixed(1)} mm`;
  return (
    <Section title="Output Size" help="How big your finished files will be, whatever the size of the image.">
      <div className="app-size">
        <ToggleGroup
          label="Set the Output Size By"
          value={s.sizeBy}
          onChange={(sizeBy) => update({ sizeBy })}
          options={[
            { value: "width", label: "Width" },
            { value: "height", label: "Height" },
          ]}
        />
        <Field
          label={s.sizeBy === "width" ? "Output Width" : "Output Height"}
          hint={follow && `${s.sizeBy === "width" ? "Height" : "Width"} follows at ${follow}`}
          error={s.size > 0 ? undefined : "Enter an output size above 0."}
        >
          <NumberInput unit={s.unit} value={s.size} min={0} onChange={(size) => update({ size: size ?? 0 })} />
        </Field>
        <Field label="Units">
          <Select
            value={s.unit}
            onChange={(unit) => {
              if (unit === s.unit) return;
              update({ unit, size: unit === "in" ? s.size / 25.4 : s.size * 25.4 });
            }}
            options={[
              { value: "mm", label: "Millimeters" },
              { value: "in", label: "Inches" },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}
