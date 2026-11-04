import { type ReactNode, useEffect, useId, useRef } from "react";

/**
 * A modal window (native `<dialog>`): the page behind is inert, focus stays
 * inside and starts on the first control, and Escape closes it unless an
 * action is running. For a yes or no question before a change, use
 * ConfirmDialog, which is built on this.
 */
export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
  busy = false,
  wide = false,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  /** Buttons at the bottom, Cancel or Close first. */
  actions?: ReactNode;
  /** Called on Escape; close it by setting `open` to false. */
  onClose: () => void;
  /** While true, Escape does not close it (an action is running). */
  busy?: boolean;
  /** Room for code or tables, such as an export. */
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={wide ? "p2c-dialog p2c-dialog-wide" : "p2c-dialog"}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="p2c-dialog-body">{children}</div>
      {actions && <div className="p2c-dialog-actions">{actions}</div>}
    </dialog>
  );
}
