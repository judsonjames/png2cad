import { Banner, Button, EmptyState, Select, TabPanel, Tabs } from "@png2cad/ui/components";
import { lazy, Suspense, useMemo, useRef, useState, type DragEvent } from "react";
import { makeSample } from "../sample";
import { useApp, type View } from "../store";
import { SourceView } from "./SourceView";
import { Viewport } from "./Viewport";

const PlateView = lazy(() => import("./PlateView"));

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

function formatSize(w: number, h: number): string {
  return `${w.toFixed(1)} x ${h.toFixed(1)} mm (${(w / 25.4).toFixed(2)} x ${(h / 25.4).toFixed(2)} in)`;
}

function DropZone() {
  const loadImage = useApp((s) => s.loadImage);
  const error = useApp((s) => s.previewError);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="app-drop-empty">
      <EmptyState
        title="Drop an Image Here"
        action={
          <div className="app-row">
            <Button variant="primary" onClick={() => input.current?.click()}>
              Choose an Image
            </Button>
            <Button onClick={() => void makeSample().then((b) => loadImage(b, "sample.png"))}>Try a Sample</Button>
          </div>
        }
      >
        PNG, JPG, WebP, GIF or BMP. You can also paste from the clipboard.
      </EmptyState>
      {error && <Banner kind="danger">{error}</Banner>}
      <input
        ref={input}
        className="app-hidden"
        type="file"
        accept={ACCEPT}
        aria-label="Choose an Image"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadImage(f, f.name);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function VectorView() {
  const preview = useApp((s) => s.preview);
  const result = useApp((s) => s.result);
  const shown = useApp((s) => s.shownNozzle);
  const setShown = useApp((s) => s.setShownNozzle);
  const busy = useApp((s) => s.previewBusy);
  const error = useApp((s) => s.previewError);
  const [backdrop, setBackdrop] = useState<"dark" | "light" | "checker">("dark");
  const fitted = shown === null ? null : (result?.nozzles.find((n) => n.nozzleMm === shown) ?? null);
  const text = fitted?.svg ?? preview?.svg ?? null;
  const url = useMemo(() => (text ? URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })) : null), [text]);
  if (error && !preview) return <Banner kind="danger">{error}</Banner>;
  if (!url || !preview) return <EmptyState title={busy ? "Tracing…" : "Nothing Traced Yet"} />;
  const w = fitted?.widthMm ?? preview.widthMm;
  const h = fitted?.heightMm ?? preview.heightMm;
  const versions = result?.nozzles ?? [];
  return (
    <>
      <div className="app-view-bar">
        <span className="app-view-size">{formatSize(w, h)}</span>
        {!fitted && <span className="app-view-note">{`${preview.paths} shapes, ${preview.nodes} curve segments`}</span>}
        {fitted && <span className="app-view-note">{`${fitted.changedPct}% of the art changed`}</span>}
        {busy && (
          <span className="app-view-note" role="status">
            Updating…
          </span>
        )}
        <span className="app-spacer" />
        {versions.length > 0 && (
          <Select
            aria-label="Version Shown"
            value={shown === null ? "art" : String(shown)}
            onChange={(v) => setShown(v === "art" ? null : Number(v))}
            options={[
              { value: "art", label: "Artwork" },
              ...versions.map((n) => ({ value: String(n.nozzleMm), label: `Fitted to ${n.nozzleMm} mm` })),
            ]}
          />
        )}
        <Select
          aria-label="Background"
          value={backdrop}
          onChange={setBackdrop}
          options={[
            { value: "dark", label: "Dark Background" },
            { value: "light", label: "Light Background" },
            { value: "checker", label: "Transparent Grid" },
          ]}
        />
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      <Viewport contentWidth={1000} contentHeight={(1000 * h) / w} backdrop={backdrop}>
        <img src={url} alt="The traced artwork" className="app-art" draggable={false} />
      </Viewport>
    </>
  );
}

export function Stage() {
  const hasImage = useApp((s) => s.image !== null);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const loadImage = useApp((s) => s.loadImage);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) void loadImage(f, f.name);
  };
  return (
    <div
      className={over ? "app-stage app-stage-over" : "app-stage"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      {!hasImage ? (
        <DropZone />
      ) : (
        <>
          <Tabs<View>
            label="Views"
            idPrefix="view"
            selected={view}
            onSelect={setView}
            items={[
              { id: "source", label: "Source" },
              { id: "vector", label: "Vector" },
              { id: "plate", label: "3D Plate" },
            ]}
          />
          <TabPanel idPrefix="view" id={view} selected={view}>
            <div className="app-view">
              {view === "source" && <SourceView />}
              {view === "vector" && <VectorView />}
              {view === "plate" && (
                <Suspense fallback={<EmptyState title="Loading the 3D View…" />}>
                  <PlateView />
                </Suspense>
              )}
            </div>
          </TabPanel>
        </>
      )}
    </div>
  );
}
