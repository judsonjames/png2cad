import type { Box, Rgb } from "@png2cad/core";
import { Button } from "@png2cad/ui/components";
import { useRef, useState, type PointerEvent } from "react";
import { useApp } from "../store";
import { Viewport } from "./Viewport";

type Tool = "move" | "crop" | "pick";

/** The source image, with tools to crop it and to pick colors from it. */
export function SourceView() {
  const image = useApp((s) => s.image);
  const url = useApp((s) => s.imageUrl);
  const crop = useApp((s) => s.crop);
  const setCrop = useApp((s) => s.setCrop);
  const palette = useApp((s) => s.palette);
  const setPalette = useApp((s) => s.setPalette);
  const mode = useApp((s) => s.settings.mode);
  const [tool, setTool] = useState<Tool>("move");
  const [draft, setDraft] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!image || !url) return null;

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(((e.clientX - r.left) / r.width) * image.width, 0), image.width),
      y: Math.min(Math.max(((e.clientY - r.top) / r.height) * image.height, 0), image.height),
    };
  };
  const box = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
    x0: Math.round(Math.min(a.x, b.x)),
    y0: Math.round(Math.min(a.y, b.y)),
    x1: Math.round(Math.max(a.x, b.x)),
    y1: Math.round(Math.max(a.y, b.y)),
  });
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (tool === "pick") {
      const p = at(e);
      const i =
        (Math.min(Math.floor(p.y), image.height - 1) * image.width + Math.min(Math.floor(p.x), image.width - 1)) * 4;
      const color: Rgb = [image.data[i], image.data[i + 1], image.data[i + 2]];
      if (palette.length < 8) setPalette([...palette, color]);
      setTool("move");
    } else if (tool === "crop") {
      e.currentTarget.setPointerCapture(e.pointerId);
      start.current = at(e);
      setDraft(box(start.current, start.current));
    }
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current) setDraft(box(start.current, at(e)));
  };
  const onUp = () => {
    if (start.current && draft && draft.x1 - draft.x0 > 4 && draft.y1 - draft.y0 > 4) {
      void setCrop(draft);
      setTool("move");
    }
    start.current = null;
    setDraft(null);
  };
  const shown = draft ?? crop;
  // Scaled to a fixed layout width; the crop box is drawn in image pixels through the SVG's viewBox.
  const width = 1000;
  const height = (1000 * image.height) / image.width;
  return (
    <>
      <div className="app-view-bar">
        <span className="app-view-size">{`${image.width} x ${image.height} px`}</span>
        <span className="app-spacer" />
        <Button aria-pressed={tool === "crop"} onClick={() => setTool(tool === "crop" ? "move" : "crop")}>
          Crop
        </Button>
        {crop && <Button onClick={() => void setCrop(null)}>Clear Crop</Button>}
        {mode === "colors" && (
          <Button aria-pressed={tool === "pick"} onClick={() => setTool(tool === "pick" ? "move" : "pick")}>
            Pick a Color
          </Button>
        )}
      </div>
      <Viewport contentWidth={width} contentHeight={height} backdrop="checker" pannable={tool === "move"}>
        <div
          className={tool === "move" ? "app-source" : "app-source app-source-tool"}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <img src={url} alt="The source" className="app-art" draggable={false} />
          {shown && (
            <svg
              className="app-crop"
              viewBox={`0 0 ${image.width} ${image.height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                className="app-crop-shade"
                d={`M0 0H${image.width}V${image.height}H0Z M${shown.x0} ${shown.y0}H${shown.x1}V${shown.y1}H${shown.x0}Z`}
              />
              <rect
                className="app-crop-edge"
                x={shown.x0}
                y={shown.y0}
                width={shown.x1 - shown.x0}
                height={shown.y1 - shown.y0}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
        </div>
      </Viewport>
    </>
  );
}
