import { type ReactNode, useId } from "react";

export interface SectionProps {
  title: ReactNode;
  /** A short explanation under the heading. */
  help?: ReactNode;
  /** Controls on the heading's right, such as a badge or a button. */
  actions?: ReactNode;
  /** Short muted text before the actions, such as "synced 2 min ago" or "12 of 13 pass". */
  meta?: ReactNode;
  children?: ReactNode;
  /** Heading level inside the page (default 2). */
  level?: 2 | 3;
  className?: string;
}

/** A titled panel: the building block of every page. */
export function Section({ title, help, actions, meta, children, level = 2, className }: SectionProps) {
  const id = useId();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={["p2c-section", className].filter(Boolean).join(" ")} aria-labelledby={id}>
      <div className="p2c-section-heading">
        <Heading id={id}>{title}</Heading>
        {(meta || actions) && (
          <div className="p2c-section-actions">
            {meta && <span className="p2c-section-meta">{meta}</span>}
            {actions}
          </div>
        )}
      </div>
      {help && <p className="p2c-help">{help}</p>}
      {children}
    </section>
  );
}

/** A collapsible group inside a section, open or closed by default. */
export function Disclosure({
  summary,
  children,
  open = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="p2c-disclosure" open={open}>
      <summary>{summary}</summary>
      <div className="p2c-disclosure-body">{children}</div>
    </details>
  );
}
