import { Button } from "@png2cad/ui/components";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

/**
 * A pannable, zoomable picture. Scroll or pinch to zoom and drag to pan; the buttons and arrow keys do the same without a mouse.
 * Content is laid out at contentWidth x contentHeight and scaled, so SVG stays sharp at any zoom.
 */
export interface ViewState {
  scale: number;
  x: number;
  y: number;
}

export function Viewport({
  contentWidth,
  contentHeight,
  backdrop = "dark",
  pannable = true,
  linked,
  overlay,
  children,
}: {
  contentWidth: number;
  contentHeight: number;
  backdrop?: "dark" | "light" | "checker";
  /** False while a tool on the content uses the mouse; scrolling and the buttons still work. */
  pannable?: boolean;
  /** Shared by pictures that pan and zoom together. */
  linked?: { view: ViewState; setView: Dispatch<SetStateAction<ViewState>> };
  /** Shown over the picture without moving it, such as progress. */
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [ownView, setOwnView] = useState<ViewState>({ scale: 1, x: 0, y: 0 });
  const view = linked?.view ?? ownView;
  const setView = linked?.setView ?? setOwnView;
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  // Every finger or pointer down on the picture, and the pinch they make when there are two.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number; view: ViewState } | null>(null);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / contentWidth, el.clientHeight / contentHeight) * 0.94;
    setView({
      scale,
      x: (el.clientWidth - contentWidth * scale) / 2,
      y: (el.clientHeight - contentHeight * scale) / 2,
    });
  }, [contentWidth, contentHeight, setView]);

  useEffect(() => {
    fit();
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [fit]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      setView((v) => {
        const scale = Math.min(Math.max(v.scale * factor, 0.02), 200);
        const k = scale / v.scale;
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    },
    [setView],
  );

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
  /** Start over from the fingers now down: one pans, two pinch. */
  const regrip = () => {
    const el = box.current;
    const points = [...pointers.current.values()];
    const v = latest.current;
    drag.current = null;
    pinch.current = null;
    if (points.length >= 2 && el) {
      const [a, b] = points;
      const r = el.getBoundingClientRect();
      pinch.current = {
        dist: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
        mx: (a.x + b.x) / 2 - r.left,
        my: (a.y + b.y) / 2 - r.top,
        view: v,
      };
    } else if (points.length === 1) {
      drag.current = { x: points[0].x, y: points[0].y, vx: v.x, vy: v.y };
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!pannable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    regrip();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = pinch.current;
    const el = box.current;
    if (p && el && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const r = el.getBoundingClientRect();
      const scale = Math.min(Math.max((p.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist, 0.02), 200);
      const k = scale / p.view.scale;
      // The point under the fingers stays under them, and moving both fingers pans.
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      setView({ scale, x: mx - (p.mx - p.view.x) * k, y: my - (p.my - p.view.y) * k });
      return;
    }
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const onPointerEnd = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    regrip();
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
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
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
      {overlay}
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
