// Tooltips that are easy to find and read: an "i" marker (InfoTip) beside
// anything with more to say, or a wrapper (Tip) around a control. They open at
// once on hover or keyboard focus, and on tap for touch screens; Escape, moving
// away or scrolling closes them. The text sits in the browser's top layer
// (popover), so a scrolling pane never clips it, and is placed below its anchor,
// or above when there is no room, inside the window.
import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { place } from "./place";

/** Closes the tooltip that is open, so only one shows at a time. */
let closeOpen: (() => void) | null = null;

/** The shared open, close and placement logic. */
function useTip() {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = tip.current;
    if (!open || !element || !anchor.current) return;
    const close = () => setOpen(false);
    if (closeOpen !== close) closeOpen?.();
    closeOpen = close;
    element.showPopover?.();
    place(element, anchor.current);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      if (closeOpen === close) closeOpen = null;
      element.hidePopover?.();
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const setAnchor = useCallback((element: HTMLElement | null) => {
    anchor.current = element;
  }, []);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const bubble = (text: ReactNode) => (
    <div id={id} ref={tip} role="tooltip" popover="manual" className="p2c-tip">
      {text}
    </div>
  );
  return { id, setAnchor, show, hide, toggle, bubble };
}

/**
 * An "i" marker that shows `text` on hover, focus or tap. `label` names it for
 * screen readers (what it explains), which also read the text as its description.
 */
export function InfoTip({ text, label = "More information" }: { text: ReactNode; label?: string }) {
  const { id, setAnchor, show, hide, toggle, bubble } = useTip();
  // A tap also sends a pointer-enter and a focus before its click. Left to open the tip, they would let the click
  // shut it again at once, so on touch only the click counts.
  const touched = useRef(false);
  return (
    <>
      {/* A span, not a button: a disabled fieldset would disable a button, and
          an explanation should stay readable while its control is locked. */}
      <span
        ref={setAnchor}
        role="button"
        tabIndex={0}
        className="p2c-tip-marker"
        aria-label={label}
        aria-describedby={id}
        onPointerDown={(e) => {
          touched.current = e.pointerType !== "mouse";
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
        onFocus={() => {
          if (!touched.current) show();
        }}
        onBlur={hide}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        i
      </span>
      {bubble(text)}
    </>
  );
}

/** Shows `text` while the pointer is over `children` or it has keyboard focus (for buttons and links). */
export function Tip({ text, children }: { text: ReactNode; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const { id, setAnchor, show, hide, bubble } = useTip();
  return (
    <span
      ref={setAnchor}
      className="p2c-tip-anchor"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
      onFocus={show}
      onBlur={hide}
    >
      {cloneElement(children, { "aria-describedby": id })}
      {bubble(text)}
    </span>
  );
}
