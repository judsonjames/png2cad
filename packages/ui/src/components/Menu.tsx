// A menu button: a button that opens a short
// list of actions. The list is a popover in the top layer, so a scrolling pane
// never clips it, and it closes on a click outside. Keyboard as in the ARIA
// menu button pattern: opening focuses the first action, arrow keys move with
// wrap-around, Home and End jump, Escape or Tab closes, and closing puts focus
// back on the button.
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";
import { place } from "./place";

export interface MenuItem {
  id: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Drawn in the danger color; confirm it in a dialog before acting. */
  danger?: boolean;
  /** A line above this item, to keep risky actions apart. */
  divider?: boolean;
}

export function Menu({
  label,
  button,
  items,
  align = "end",
  className,
}: {
  /** The menu's name for screen readers when `button` is not plain text. */
  label: string;
  /** What the button shows, such as "More ▾". */
  button: ReactNode;
  items: MenuItem[];
  /** Which edge of the button the list lines up with. */
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const actions = () => [
    ...(list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []),
  ];
  const close = () => {
    list.current?.hidePopover?.();
    anchor.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = actions();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (at + 1) % all.length
        : event.key === "ArrowUp"
          ? (at - 1 + all.length) % all.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? all.length - 1
              : -1;
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close();
    } else if (next >= 0 && all.length) {
      event.preventDefault();
      all[next].focus();
    }
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={["p2c-drop-button", className].filter(Boolean).join(" ")}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onKeyDown={(event) => {
          // Arrow down on the closed button opens it, like a click.
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            list.current?.showPopover?.();
          }
        }}
      >
        {button}
      </button>
      <div
        ref={list}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        className="p2c-menu"
        onKeyDown={onKeyDown}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (opened && list.current && anchor.current) {
            place(list.current, anchor.current, align);
            actions()[0]?.focus();
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={item.disabled}
            className={[
              "p2c-menu-item",
              item.danger ? "p2c-menu-item-danger" : "",
              item.divider ? "p2c-menu-item-divider" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => {
              close();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
