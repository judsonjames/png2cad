import type { ReactNode } from "react";

/**
 * What a panel shows when it has nothing yet (no image, no
 * files): what is missing, why it matters and one way to start.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  /** One control that starts, such as "Choose an Image". */
  action?: ReactNode;
}) {
  return (
    <div className="p2c-empty">
      <p className="p2c-empty-title">{title}</p>
      {children && <div className="p2c-empty-text">{children}</div>}
      {action && <div className="p2c-empty-action">{action}</div>}
    </div>
  );
}

/**
 * Gray blocks in the shape of content that is still loading. Screen readers
 * hear `label` once instead of the empty blocks.
 */
export function Placeholder({ lines = 3, label = "Loading" }: { lines?: number; label?: string }) {
  return (
    <div className="p2c-placeholder" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="p2c-placeholder-line" aria-hidden="true" />
      ))}
    </div>
  );
}
