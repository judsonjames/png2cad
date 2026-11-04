import type { ReactNode } from "react";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

/**
 * A short status label in a pill. The text carries the meaning, not only the
 * color. `dot` adds a status dot before the text, for header state chips
 * ("● Connected").
 */
export function Badge({
  tone = "neutral",
  children,
  title,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
  dot?: boolean;
}) {
  return (
    <span className={`p2c-badge p2c-tone-${tone}${dot ? " p2c-badge-with-dot" : ""}`} title={title}>
      {dot && <span className="p2c-badge-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export type ReadinessLevel = "green" | "amber" | "red";

const LEVEL: Record<ReadinessLevel, { tone: Tone; text: string }> = {
  green: { tone: "ok", text: "Ready" },
  amber: { tone: "warn", text: "Ready, with warnings" },
  red: { tone: "danger", text: "Not ready" },
};

/** A readiness level as a badge: Ready, Ready with warnings, Not ready (with a count). */
export function Level({ level, count }: { level: ReadinessLevel; count?: number }) {
  const { tone, text } = LEVEL[level];
  return <Badge tone={tone}>{count ? `${text} · ${count}` : text}</Badge>;
}
