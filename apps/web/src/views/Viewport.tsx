import { Button } from "@png2cad/ui/components";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/**
 * A pannable, zoomable picture. Scroll to zoom and drag to pan; the buttons and arrow keys do the same without a mouse.
 * Content is laid out at contentWidth x contentHeight and scaled, so SVG stays sharp at any zoom.
 */
export function Viewport({
  contentWidth,
  contentHeight,
  backdrop = "dark",
  pannable = true,
  children,
}: {
  contentWidth: number;
  contentHeight: number;
  backdrop?: "dark" | "light" | "checker";
  /** False while a tool on the content uses the mouse; scrolling and the buttons still work. */
  pannable?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / contentWidth, el.clientHeight / contentHeight) * 0.94;
    setView({
      scale,
      x: (el.clientWidth - contentWidth * scale) / 2,
      y: (el.clientHeight - contentHeight * scale) / 2,
    });
  }, [contentWidth, contentHeight]);

  useEffect(() => {
    fit();
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, 0.02), 200);
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Added by hand: React's wheel listener is passive, so it could not stop the page scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const center = (factor: number) => {
    const el = box.current;
    if (el) zoomAt(factor, el.clientWidth / 2, el.clientHeight / 2);
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!pannable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const step = 40;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = move[e.key];
    if (m) {
      e.preventDefault();
      setView((v) => ({ ...v, x: v.x + m[0], y: v.y + m[1] }));
    } else if (e.key === "+" || e.key === "=") center(1.25);
    else if (e.key === "-") center(0.8);
    else if (e.key === "0") fit();
  };

  return (
    <div className={`app-viewport app-viewport-${backdrop}`}>
      <div
        ref={box}
        className="app-viewport-box"
        role="group"
        tabIndex={0}
        aria-label="Picture. Arrow keys pan; plus and minus zoom; zero fits."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
      >
        <div
          className="app-viewport-content"
          style={{
            width: contentWidth,
            height: contentHeight,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          {children}
        </div>
      </div>
      <div className="app-viewport-tools">
        <Button aria-label="Zoom In" onClick={() => center(1.5)}>
          +
        </Button>
        <Button aria-label="Zoom Out" onClick={() => center(1 / 1.5)}>
          −
        </Button>
        <Button onClick={fit}>Fit</Button>
      </div>
    </div>
  );
}
