import { useId } from "react";
import { ACCENTS, BASES, type Scheme } from "../scheme";

/**
 * Pick a color scheme: an accent and a background, each a row of
 * swatches (radio buttons, so arrow keys move between them), with a preview in
 * the picked colors. The caller saves; this only reports the choice.
 */
export function SchemePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: Scheme;
  onChange: (scheme: Scheme) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div className="p2c-scheme">
      <fieldset className="p2c-scheme-row" disabled={disabled}>
        <legend>Accent</legend>
        {ACCENTS.map((accent) => (
          <label key={accent.id} className="p2c-swatch">
            <input
              type="radio"
              name={`${name}-accent`}
              value={accent.id}
              checked={value.accent === accent.id}
              onChange={() => onChange({ ...value, accent: accent.id })}
            />
            <span className="p2c-swatch-chip" style={{ background: accent.swatch }} aria-hidden="true" />
            {accent.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="p2c-scheme-row" disabled={disabled}>
        <legend>Background</legend>
        {BASES.map((base) => (
          <label key={base.id} className="p2c-swatch">
            <input
              type="radio"
              name={`${name}-base`}
              value={base.id}
              checked={value.base === base.id}
              onChange={() => onChange({ ...value, base: base.id })}
            />
            <span className="p2c-swatch-chip p2c-swatch-base" style={{ background: base.swatch }} aria-hidden="true" />
            {base.label}
          </label>
        ))}
      </fieldset>
      <SchemePreview scheme={value} />
    </div>
  );
}

/** A few controls drawn in `scheme`, whatever the page's own scheme is. */
export function SchemePreview({ scheme }: { scheme: Scheme }) {
  return (
    <div className="p2c-scheme-preview" data-accent={scheme.accent} data-base={scheme.base} aria-hidden="true">
      <div className="p2c-scheme-preview-tabs">
        <span className="p2c-scheme-preview-tab p2c-scheme-preview-on">Cameras</span>
        <span className="p2c-scheme-preview-tab">Calibration</span>
        <span className="p2c-scheme-preview-tab">Mounts</span>
      </div>
      <div className="p2c-scheme-preview-panel">
        <span className="p2c-scheme-preview-button">Save</span>
        <span className="p2c-scheme-preview-link">A link</span>
        <span className="p2c-scheme-preview-muted">A hint</span>
        <span className="p2c-scheme-preview-danger">Not saved</span>
      </div>
    </div>
  );
}
