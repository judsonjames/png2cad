import type { ReactNode } from "react";

export type BannerKind = "info" | "ok" | "warn" | "danger";

/**
 * A full-width message. Warnings and dangers are announced right away
 * (`role="alert"`); info and ok politely (`role="status"`).
 *
 * As an attention item it can carry a `detail` line under the message and one
 * `action` (a button or link to where the problem is fixed) on its right. Those
 * are a list the page shows (Status's Needs Attention), read in place: they are
 * not live regions, so opening the page does not announce each one.
 */
export function Banner({
  kind = "info",
  title,
  detail,
  action,
  children,
}: {
  kind?: BannerKind;
  title?: ReactNode;
  /** A second line: what was found, in smaller text. */
  detail?: ReactNode;
  /** One control on the right, such as "Calibrate rear". */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const role = kind === "warn" || kind === "danger" ? "alert" : "status";
  if (detail === undefined && action === undefined) {
    return (
      <div className={`p2c-banner p2c-banner-${kind}`} role={role}>
        {title && <strong className="p2c-banner-title">{title}</strong>}
        {children}
      </div>
    );
  }
  return (
    <div className={`p2c-banner p2c-banner-${kind} p2c-banner-item`}>
      <div className="p2c-banner-text">
        {title && <strong className="p2c-banner-title">{title}</strong>}
        {children}
        {detail && <p className="p2c-banner-detail">{detail}</p>}
      </div>
      {action && <div className="p2c-banner-action">{action}</div>}
    </div>
  );
}
