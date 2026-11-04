// Placing a floating box (tooltip, drop-down panel) next to what opened it.

/**
 * Puts `box` next to `anchor`: below it, or above when it would not fit,
 * kept 8 px inside the window. `align` lines it up with the anchor's center
 * (tooltips) or its left or right edge (drop-down panels).
 */
export function place(box: HTMLElement, anchor: HTMLElement, align: "center" | "start" | "end" = "center") {
  const a = anchor.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const gap = 6;
  let top = a.bottom + gap;
  if (top + b.height > window.innerHeight - 8) top = Math.max(8, a.top - gap - b.height);
  const wanted = align === "start" ? a.left : align === "end" ? a.right - b.width : a.left + a.width / 2 - b.width / 2;
  const left = Math.max(8, Math.min(wanted, window.innerWidth - b.width - 8));
  box.style.top = `${top}px`;
  box.style.left = `${left}px`;
}
