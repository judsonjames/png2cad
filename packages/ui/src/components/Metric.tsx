import type { ReactNode } from "react";
import type { Tone } from "./Badge";

/** A value that says the reading is missing ("Unavailable", "unavailable: …"). */
function missing(value: ReactNode): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("unavailable");
}

/**
 * One reading: a small label over a large value, with an optional note. A
 * missing reading still says "Unavailable" (UI-06) but quietly, not at
 * headline size.
 */
export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      className={["p2c-metric", tone ? `p2c-tone-${tone}` : "", missing(value) ? "p2c-metric-missing" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="p2c-metric-label">{label}</span>
      <span className="p2c-metric-value">{value}</span>
      {note && <span className="p2c-metric-note">{note}</span>}
    </div>
  );
}

/** Readings in a grid that wraps on narrow screens. */
export function MetricGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  return <div className={`p2c-metric-grid p2c-columns-${columns}`}>{children}</div>;
}
