import { type ReactElement, type ReactNode, cloneElement, useId, useState } from "react";
import { InfoTip } from "./Tooltip";

export interface FieldProps {
  label: ReactNode;
  /** One control (input, select or textarea); it gets the field's id. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  hint?: ReactNode;
  /** A problem with the value, shown in place of the hint. */
  error?: ReactNode;
  /** More about the field, behind an "i" marker beside the label. */
  info?: ReactNode;
}

/** A labelled control with an optional hint or error, tied together for screen readers. */
export function Field({ label, children, hint, error, info }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={error ? "p2c-field p2c-field-error" : "p2c-field"}>
      {info ? (
        <span className="p2c-field-label">
          <label htmlFor={id}>{label}</label>
          <InfoTip text={info} label={typeof label === "string" ? `About ${label}` : undefined} />
        </span>
      ) : (
        <label htmlFor={id}>{label}</label>
      )}
      {cloneElement(children, { id, "aria-describedby": note ? noteId : undefined })}
      {note && (
        <span id={noteId} className="p2c-field-note" role={error ? "alert" : undefined}>
          {note}
        </span>
      )}
    </div>
  );
}

export type NumberUnit = "mm" | "in" | "deg" | "px" | "%" | "layers" | "x" | "";

export interface NumberInputProps {
  /** The value as shown, in `unit`. */
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: NumberUnit;
  /** Decimals shown; defaults suit the unit. */
  digits?: number;
  min?: number;
  max?: number;
  step?: number | "any";
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}

function shown(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(digits)));
}

/** A number field with its unit after it. Typing keeps the text as typed until it parses. */
export function NumberInput({
  value,
  onChange,
  unit = "",
  digits,
  min,
  max,
  step,
  disabled,
  ...rest
}: NumberInputProps) {
  const places = digits ?? (unit === "mm" ? 2 : unit === "in" ? 3 : 2);
  const [text, setText] = useState(() => shown(value, places));
  // Follow the stored value when it changes from outside, but not while the
  // text typed so far already means that value ("0." stays "0.").
  const [seen, setSeen] = useState({ value, unit });
  if (seen.value !== value || seen.unit !== unit) {
    setSeen({ value, unit });
    const parsed = Number(text);
    const typed = text.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
    const same = typed === null ? value === null : value !== null && Math.abs(typed - value) < 1e-9;
    if (!same || seen.unit !== unit) setText(shown(value, places));
  }
  return (
    <span className="p2c-number">
      <input
        type="number"
        inputMode="decimal"
        value={text}
        min={min}
        max={max}
        step={step ?? "any"}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          const parsed = Number(event.target.value);
          if (event.target.value.trim() === "") onChange(null);
          else if (Number.isFinite(parsed)) onChange(parsed);
        }}
        {...rest}
      />
      {unit && <span className="p2c-number-unit">{unit === "deg" ? "°" : unit}</span>}
    </span>
  );
}

export interface ToggleOption<V extends string> {
  value: V;
  label: ReactNode;
}

/** A row of mutually exclusive choices, each a button with `aria-pressed`. */
export function ToggleGroup<V extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: ToggleOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="p2c-toggle-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="p2c-toggle"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface SelectOption<V extends string> {
  value: V;
  /** Plain text: a native option cannot hold markup. */
  label: string;
  disabled?: boolean;
}

/**
 * A drop-down list: a styled native `<select>`, so the keyboard, type-ahead
 * and screen readers work as everywhere else. Put it in a Field for its label,
 * or give it `aria-label`. A null value shows `placeholder`.
 */
export function Select<V extends string>({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  disabled,
  id,
  "aria-describedby": describedBy,
  "aria-label": ariaLabel,
}: {
  value: V | null;
  onChange: (value: V) => void;
  options: SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      className="p2c-select"
      id={id}
      aria-describedby={describedBy}
      aria-label={ariaLabel}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as V)}
    >
      {value === null && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A native checkbox with its label beside it and an optional hint under the label. */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const hintId = useId();
  return (
    <label className="p2c-checkbox">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="p2c-checkbox-text">
        <span>{label}</span>
        {hint && (
          <span id={hintId} className="p2c-field-note">
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * An on/off setting drawn as a toggle: a native checkbox with
 * `role="switch"`, so the keyboard (Space) and screen readers ("switch, on")
 * work as usual. Use it for a setting that is on or off; use Checkbox for
 * choosing items from a list. `info` adds an "i" marker after the label.
 */
export function Switch({
  checked,
  onChange,
  label,
  info,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  info?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <span className="p2c-field-label p2c-switch-row">
      <label className="p2c-switch">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="p2c-switch-track" aria-hidden="true">
          <span className="p2c-switch-thumb" />
        </span>
        <span>{label}</span>
      </label>
      {info && <InfoTip text={info} label={typeof label === "string" ? `About ${label}` : undefined} />}
    </span>
  );
}
