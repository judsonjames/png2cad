// The desktop layout: side-by-side panes that fill the window and scroll on
// their own, so a picture in one pane stays in view while settings in another
// scroll. Narrower than `breakpoints.wide` (1200 px) the panes stack and the
// page scrolls, unless `always` is set.
import { type CSSProperties, type ReactNode, useSyncExternalStore } from "react";

/**
 * Side-by-side panes. `columns` is a CSS grid track list, one track per pane
 * (default: the first pane 3 parts, the second 2).
 */
export function Workspace({
  columns,
  always = false,
  children,
}: {
  columns?: string;
  always?: boolean;
  children: ReactNode;
}) {
  const style = columns ? ({ "--p2c-workspace-columns": columns } as CSSProperties) : undefined;
  return (
    <div className={always ? "p2c-workspace p2c-workspace-always" : "p2c-workspace"} style={style}>
      {children}
    </div>
  );
}

/** One pane of a workspace; it scrolls on its own when it is side by side. */
export function Pane({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div
      className={className ? `p2c-pane ${className}` : "p2c-pane"}
      role={label ? "region" : undefined}
      aria-label={label}
    >
      {children}
    </div>
  );
}

/**
 * Room for a picture in a pane: as tall as the picture is at the pane's width,
 * or less when the pane is shorter, so the picture inside fits both ways
 * and what follows it stays right below. `aspect` is width over height. The
 * picture is an image or a canvas.
 */
export function Fit({ aspect, children }: { aspect?: number; children: ReactNode }) {
  const style = aspect ? ({ "--p2c-aspect": aspect } as CSSProperties) : undefined;
  return (
    <div className="p2c-fit" style={style}>
      {children}
    </div>
  );
}

/** True while the media query matches (for layouts CSS alone cannot rearrange). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (change) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", change);
      return () => list.removeEventListener("change", change);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
