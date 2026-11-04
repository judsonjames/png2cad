import { type ReactNode, useId } from "react";

/**
 * How far a task has come (files made, steps done), as a native
 * `<progress>`. A null value draws it running with no known end. `text` says
 * the same in words, such as "2 of 4 nozzles".
 */
export function Progress({
  value,
  max = 1,
  label,
  text,
}: {
  value: number | null;
  max?: number;
  label: ReactNode;
  text?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="p2c-progress">
      <div className="p2c-progress-labels">
        <span id={id}>{label}</span>
        {text && <span className="p2c-progress-text">{text}</span>}
      </div>
      <progress aria-labelledby={id} max={max} value={value ?? undefined} />
    </div>
  );
}

/**
 * A measurement within a known range (a share of something), as a native `<meter>`. The browser colors it by where `value` falls
 * against `low`, `high` and `optimum`; `text` gives the number in words.
 */
export function Meter({
  value,
  min = 0,
  max = 1,
  low,
  high,
  optimum,
  label,
  text,
}: {
  value: number;
  min?: number;
  max?: number;
  low?: number;
  high?: number;
  optimum?: number;
  label: ReactNode;
  text?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="p2c-progress">
      <div className="p2c-progress-labels">
        <span id={id}>{label}</span>
        {text && <span className="p2c-progress-text">{text}</span>}
      </div>
      <meter aria-labelledby={id} min={min} max={max} low={low} high={high} optimum={optimum} value={value} />
    </div>
  );
}
