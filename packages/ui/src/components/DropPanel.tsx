// A button that opens a small panel below it (the app's profile and
// connection details). The panel is a popover: it sits in the top layer, closes
// on Escape or a click outside, and is placed inside the window.
import { type ReactNode, useId, useRef } from "react";
import { place } from "./place";

export function DropPanel({
  label,
  button,
  children,
  align = "end",
  className,
}: {
  /** What the panel is, for screen readers (the panel's accessible name). */
  label: string;
  /** What the button shows (a summary such as the profile's name). It is also the
   * button's accessible name, so the words people see are the words a screen reader
   * or voice control uses; add visually hidden words for context, and hide symbols. */
  button: ReactNode;
  /** The panel's content; `close` closes it after an action. */
  children: (close: () => void) => ReactNode;
  /** Which edge of the button the panel lines up with. */
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // By id, not the ref: `close` is handed to the content while it renders.
  const close = () => document.getElementById(id)?.hidePopover?.();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={["p2c-drop-button", className].filter(Boolean).join(" ")}
        popoverTarget={id}
      >
        {button}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="p2c-drop-panel"
        onToggle={(e) => {
          if (e.newState === "open" && panel.current && anchor.current) place(panel.current, anchor.current, align);
        }}
      >
        {children(close)}
      </div>
    </>
  );
}
