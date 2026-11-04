import type { ReactNode } from "react";
import { Disclosure } from "./Section";

/** A check's result. */
export type CheckState = "pass" | "unknown" | "warn" | "fail";

/** The word shown with each state: the text carries the meaning, not the color. */
const WORD: Record<CheckState, string> = {
  pass: "Pass",
  unknown: "Unknown",
  warn: "Warning",
  fail: "Fault",
};

/** A mark beside the word, for scanning. Hidden from screen readers, which read the word. */
const MARK: Record<CheckState, string> = {
  pass: "✓",
  unknown: "?",
  warn: "!",
  fail: "✕",
};

/** Problems first: faults, then warnings, then unknowns. */
const ORDER: Record<CheckState, number> = { fail: 0, warn: 1, unknown: 2, pass: 3 };

/**
 * The one-line answer at the top of a status page ("Ready", "1 thing to do").
 * Quiet when it passes (ISA-101): only a warning or a fault is drawn as a
 * colored box. Changes are announced politely.
 */
export function Verdict({
  state,
  title,
  detail,
  meta,
}: {
  state: CheckState;
  title: ReactNode;
  /** One line under the title, such as which file needs attention. */
  detail?: ReactNode;
  /** Muted text on the right, such as "checked 2 s ago". */
  meta?: ReactNode;
}) {
  return (
    <div className={`p2c-verdict p2c-verdict-${state}`} role="status">
      <span className="p2c-verdict-mark" aria-hidden="true">
        {MARK[state]}
      </span>
      <div className="p2c-verdict-text">
        <p className="p2c-verdict-title">{title}</p>
        {detail && <p className="p2c-verdict-detail">{detail}</p>}
      </div>
      {meta && <span className="p2c-verdict-meta">{meta}</span>}
    </div>
  );
}

export interface CheckItem {
  id: string;
  label: ReactNode;
  state: CheckState;
  /** What was found, or what to do. */
  detail?: ReactNode;
  /** One control that leads to the fix, such as "Open calibration". */
  action?: ReactNode;
}

/** One check: its state as a word and a mark, its name, what was found and one action. */
export function CheckRow({ label, state, detail, action }: Omit<CheckItem, "id">) {
  return (
    <li className={`p2c-check p2c-check-${state}`}>
      <span className="p2c-check-state">
        <span className="p2c-check-mark" aria-hidden="true">
          {MARK[state]}
        </span>
        {WORD[state]}
      </span>
      <div className="p2c-check-text">
        <span className="p2c-check-label">{label}</span>
        {/* A div, so a detail can be a list (one problem per file). */}
        {detail && <div className="p2c-check-detail">{detail}</div>}
      </div>
      {action && <div className="p2c-check-action">{action}</div>}
    </li>
  );
}

/**
 * A list of checks with problems first. Passing checks fold into one line
 * ("12 passing") that opens to show them; faults, warnings and unknowns are
 * never folded away.
 */
export function CheckList({
  items,
  label,
  collapsePassing = true,
}: {
  items: CheckItem[];
  /** Names the list for screen readers, such as "File checks". */
  label: string;
  collapsePassing?: boolean;
}) {
  const sorted = [...items].sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const problems = collapsePassing ? sorted.filter((item) => item.state !== "pass") : sorted;
  const passing = collapsePassing ? sorted.filter((item) => item.state === "pass") : [];
  const rows = (list: CheckItem[]) => list.map(({ id, ...item }) => <CheckRow key={id} {...item} />);
  return (
    <div className="p2c-check-list">
      {problems.length > 0 && (
        <ul className="p2c-checks" aria-label={label}>
          {rows(problems)}
        </ul>
      )}
      {passing.length > 0 && (
        <Disclosure summary={`${passing.length} passing`}>
          <ul className="p2c-checks" aria-label={`${label}: passing`}>
            {rows(passing)}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
