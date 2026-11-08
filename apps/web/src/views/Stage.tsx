import { Banner, Button, EmptyState, InfoTip, Progress, Select, Switch, TabPanel, Tabs } from "@png2cad/ui/components";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { makeSample } from "../sample";
import {
  isLineTarget,
  previewNozzle,
  previewPicture,
  previewTargets,
  useApp,
  type CompareEntry,
  type Settings,
  type View,
} from "../store";
import { SourceView } from "./SourceView";
import { Viewport, type ViewState } from "./Viewport";

const PlateView = lazy(() => import("./PlateView"));

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp";

/** Both units, the one in use first. */
function formatSize(w: number, h: number, unit: "mm" | "in"): string {
  const mm = `${w.toFixed(1)} x ${h.toFixed(1)} mm`;
  const inches = `${(w / 25.4).toFixed(2)} x ${(h / 25.4).toFixed(2)} in`;
  return unit === "in" ? `${inches} (${mm})` : `${mm} (${inches})`;
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
        PNG, JPG, WebP, GIF or BMP, such as a PNG shared from Procreate. You can also paste from the clipboard.
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

type Backdrop = "dark" | "light" | "checker";

function useSvgUrl(text: string | null): string | null {
  const url = useMemo(() => (text ? URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })) : null), [text]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function BackdropSelect({ value, onChange }: { value: Backdrop; onChange: (value: Backdrop) => void }) {
  return (
    <Select
      aria-label="Background"
      value={value}
      onChange={onChange}
      options={[
        { value: "dark", label: "Dark Background" },
        { value: "light", label: "Light Background" },
        { value: "checker", label: "Transparent Grid" },
      ]}
    />
  );
}

function VectorView({ backdrop, setBackdrop }: { backdrop: Backdrop; setBackdrop: (value: Backdrop) => void }) {
  const preview = useApp((s) => s.preview);
  const busy = useApp((s) => s.previewBusy);
  const full = useApp((s) => s.previewFull);
  const unit = useApp((s) => s.settings.unit);
  const showFullDetail = useApp((s) => s.showFullDetail);
  const error = useApp((s) => s.previewError);
  const url = useSvgUrl(preview?.svg ?? null);
  if (error && !preview) return <Banner kind="danger">{error}</Banner>;
  if (!url || !preview) return <EmptyState title={busy ? "Tracing…" : "Nothing Traced Yet"} />;
  return (
    <>
      <div className="app-view-bar">
        <span className="app-view-size">{formatSize(preview.widthMm, preview.heightMm, unit)}</span>
        <span className="app-view-note">{`${preview.paths} shapes, ${preview.nodes} curve segments`}</span>
        <span className="app-view-note">{full ? "Full detail" : "Quick view"}</span>
        <InfoTip
          label="About Quick View"
          text="This picture updates as you work, on a coarser grid than your files, so the smallest details look rougher here. Show Full Detail draws the art as the SVG will have it."
        />
        {busy && (
          <span className="app-view-note" role="status">
            Updating…
          </span>
        )}
        <span className="app-spacer" />
        <Button disabled={full || busy} onClick={showFullDetail}>
          Show Full Detail
        </Button>
        <BackdropSelect value={backdrop} onChange={setBackdrop} />
      </div>
      {error && <Banner kind="danger">{error}</Banner>}
      <Viewport contentWidth={1000} contentHeight={(1000 * preview.heightMm) / preview.widthMm} backdrop={backdrop}>
        <img src={url} alt="The traced artwork" className="app-art" draggable={false} />
      </Viewport>
    </>
  );
}

/** Plain words for how much of the art the nozzle moved. Above 25% the files carry a warning too. */
function detailText(changedPct: number): string {
  if (changedPct <= 10) return "Most detail kept";
  if (changedPct <= 25) return "Close lines merge";
  return "Much detail lost";
}

function targetName(s: Settings, width: number): string {
  return isLineTarget(s, width) ? `${width} mm Lines` : `${width} mm Nozzle`;
}

function CheckButton() {
  const busy = useApp((s) => s.fitBusy || s.compareBusy);
  const current = useApp((s) => s.fitCurrent);
  const ready = useApp((s) => s.settings.size > 0 && s.palette.length >= 2 && !s.exportBusy);
  const checkSize = useApp((s) => s.checkSize);
  const cancelCheck = useApp((s) => s.cancelCheck);
  if (busy) return <Button onClick={cancelCheck}>Cancel Check</Button>;
  return (
    <Button disabled={current || !ready} onClick={checkSize}>
      Check Size
    </Button>
  );
}

function StaleNote() {
  const show = useApp((s) => !s.fitCurrent && !s.fitBusy && !s.compareBusy && !s.exportBusy);
  if (!show) return null;
  return <Banner kind="warn">Settings changed since this preview. Use Check Size to update it.</Banner>;
}

function CompareSwitch() {
  const on = useApp((s) => s.compareOn);
  const setOn = useApp((s) => s.setCompareOn);
  return (
    <Switch
      label="Compare Sizes"
      checked={on}
      onChange={setOn}
      info="Fits the art at this size, 25% larger and 50% larger, so you can see what a larger print keeps. Turning this on starts all three, and each size is a full fit."
    />
  );
}

function CompareTile({
  entry,
  fitting,
  height,
  backdrop,
  linked,
}: {
  entry: CompareEntry;
  fitting: boolean;
  height: number;
  backdrop: Backdrop;
  linked: { view: ViewState; setView: (next: ViewState | ((old: ViewState) => ViewState)) => void };
}) {
  const unit = useApp((s) => s.settings.unit);
  const sizeBy = useApp((s) => s.settings.sizeBy);
  const current = useApp((s) => s.settings.size === entry.size);
  const chooseSize = useApp((s) => s.chooseSize);
  const step = useApp((s) => s.compareStep);
  const running = useApp((s) => s.compareBusy);
  const url = useSvgUrl(entry.picture?.svg ?? null);
  const name = `${entry.size} ${unit} ${sizeBy === "width" ? "wide" : "tall"}`;
  const faults = entry.picture?.findings.some((f) => f.severity === "fault") ?? false;
  return (
    <section className="app-compare-tile" aria-label={name}>
      <div className="app-view-bar">
        <span className="app-view-size">{current ? `${name} (Current Size)` : name}</span>
        {entry.picture && (
          <span className="app-view-note">
            {faults
              ? `Some spots cannot print: ${entry.picture.changedPct}% of the art changed`
              : `${detailText(entry.picture.changedPct)}: ${entry.picture.changedPct}% of the art changed`}
          </span>
        )}
        <span className="app-spacer" />
        {!current && (
          <Button disabled={!entry.picture} aria-label={`Use ${name}`} onClick={() => chooseSize(entry.size)}>
            Use This Size
          </Button>
        )}
      </div>
      {entry.error && <Banner kind="danger">{`This size was not fitted: ${entry.error}`}</Banner>}
      {url && (
        <Viewport contentWidth={1000} contentHeight={height} backdrop={backdrop} linked={linked}>
          <img src={url} alt={`The export preview at ${name}`} className="app-art" draggable={false} />
        </Viewport>
      )}
      {!url && !entry.error && (
        <div className="app-compare-wait">
          {fitting && step ? (
            <div className="app-compare-progress">
              <Progress label={`${step.message}…`} value={step.done} text={`${Math.round(step.done * 100)}%`} />
            </div>
          ) : running ? (
            "Waiting…"
          ) : (
            "Not Checked"
          )}
        </div>
      )}
    </section>
  );
}

function CompareView({ backdrop, setBackdrop }: { backdrop: Backdrop; setBackdrop: (value: Backdrop) => void }) {
  const entries = useApp((s) => s.compare);
  const busy = useApp((s) => s.compareBusy);
  const hasSize = useApp((s) => s.settings.size > 0);
  const [view, setView] = useState<ViewState>({ scale: 1, x: 0, y: 0 });
  const linked = useMemo(() => ({ view, setView }), [view]);
  const first = entries.find((e) => e.picture)?.picture ?? null;
  const height = first ? (1000 * first.heightMm) / first.widthMm : 1000;
  const fitting = entries.find((e) => !e.picture && !e.error);
  const step = useApp((s) => s.compareStep);
  return (
    <>
      <div className="app-view-bar">
        <CompareSwitch />
        <span className="app-view-note">Pan and zoom move every picture together.</span>
        {busy && (
          <span className="app-view-note" role="status">
            {step ? `Updating: size ${step.position} of ${step.count}…` : "Updating…"}
          </span>
        )}
        <span className="app-spacer" />
        <CheckButton />
        <BackdropSelect value={backdrop} onChange={setBackdrop} />
      </div>
      {hasSize && entries.length > 0 && <StaleNote />}
      {!hasSize && <EmptyState title="Enter an Output Size">The comparison needs a size to start from.</EmptyState>}
      {hasSize && (
        <div className={height < 625 ? "app-compare app-compare-rows" : "app-compare app-compare-columns"}>
          {entries.map((e) => (
            <CompareTile
              key={e.asked}
              entry={e}
              fitting={e === fitting}
              height={height}
              backdrop={backdrop}
              linked={linked}
            />
          ))}
        </div>
      )}
    </>
  );
}

function FitView({ backdrop, setBackdrop }: { backdrop: Backdrop; setBackdrop: (value: Backdrop) => void }) {
  const comparing = useApp((s) => s.compareOn);
  return comparing ? (
    <CompareView backdrop={backdrop} setBackdrop={setBackdrop} />
  ) : (
    <SingleFitView backdrop={backdrop} setBackdrop={setBackdrop} />
  );
}

function SingleFitView({ backdrop, setBackdrop }: { backdrop: Backdrop; setBackdrop: (value: Backdrop) => void }) {
  const picture = useApp(previewPicture);
  const nozzle = useApp(previewNozzle);
  const settings = useApp((s) => s.settings);
  const targets = previewTargets(settings);
  const hasSize = useApp((s) => s.settings.size > 0);
  const busy = useApp((s) => s.fitBusy);
  const step = useApp((s) => s.fitStep);
  const error = useApp((s) => s.fitError);
  const exporting = useApp((s) => s.exportBusy);
  const setShown = useApp((s) => s.setShownNozzle);
  const url = useSvgUrl(picture?.svg ?? null);
  if (!hasSize)
    return <EmptyState title="Enter an Output Size">The preview needs a size to fit the art to.</EmptyState>;
  if (!url || !picture) {
    if (exporting) return <EmptyState title="Making Files…" />;
    if (busy) {
      return (
        <EmptyState title={`Fitting to ${targetName(settings, nozzle)}…`} action={<CheckButton />}>
          This uses the same grid as your files, so it can take a few minutes on large art.
          <div className="app-fit-progress">
            <Progress
              label={`${step?.message ?? "Starting"}…`}
              value={step?.done ?? 0}
              text={`${Math.round((step?.done ?? 0) * 100)}%`}
            />
          </div>
        </EmptyState>
      );
    }
    return (
      <>
        {error && <Banner kind="danger">{`The preview was not made: ${error}`}</Banner>}
        <EmptyState
          title="See What Your Files Will Look Like"
          action={
            <div className="app-row app-check-row">
              <CheckButton />
              <CompareSwitch />
            </div>
          }
        >
          Check Size fits the art at this size and nozzle, on the same grid as your files. It can take a few minutes on
          large art.
        </EmptyState>
      </>
    );
  }
  const notes = picture.findings.filter((f) => f.severity !== "pass");
  return (
    <>
      <div className="app-view-bar">
        <span className="app-view-size">{formatSize(picture.widthMm, picture.heightMm, settings.unit)}</span>
        <span className="app-view-note">{`${detailText(picture.changedPct)}: ${picture.changedPct}% of the art changed`}</span>
        <InfoTip
          label="About Art Changed"
          text="The share of the art the nozzle fit had to move to make every line and gap printable. A larger output size or a smaller nozzle keeps more detail."
        />
        <span className="app-spacer" />
        <CheckButton />
        <CompareSwitch />
        {targets.length > 1 && (
          <Select
            aria-label="Fit Shown"
            value={String(nozzle)}
            onChange={(v) => setShown(Number(v))}
            options={targets.map((n) => ({ value: String(n), label: targetName(settings, n) }))}
          />
        )}
        <BackdropSelect value={backdrop} onChange={setBackdrop} />
      </div>
      {error && <Banner kind="danger">{`The preview was not updated: ${error}`}</Banner>}
      <StaleNote />
      {notes.map((f) => (
        <Banner key={f.code} kind={f.severity === "fault" ? "danger" : "warn"}>
          {f.message}
        </Banner>
      ))}
      <Viewport
        contentWidth={1000}
        contentHeight={(1000 * picture.heightMm) / picture.widthMm}
        backdrop={backdrop}
        overlay={
          busy && (
            <div className="app-view-progress" role="status">
              <Progress
                label={step ? `Updating: ${step.message}…` : "Updating…"}
                value={step?.done ?? 0}
                text={`${Math.round((step?.done ?? 0) * 100)}%`}
              />
            </div>
          )
        }
      >
        <img src={url} alt="The export preview" className="app-art" draggable={false} />
      </Viewport>
    </>
  );
}

export function Stage() {
  const hasImage = useApp((s) => s.image !== null);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const loadImage = useApp((s) => s.loadImage);
  const hasFit = useApp((s) => previewTargets(s.settings).length > 0);
  const hasPlate = useApp((s) => s.settings.makePlate);
  const [over, setOver] = useState(false);
  const [backdrop, setBackdrop] = useState<Backdrop>("dark");
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
              // Only what the chosen file uses: an SVG as traced has no fit to check, and only a 3MF has a plate.
              ...(hasFit ? [{ id: "fit" as const, label: "Export Preview" }] : []),
              ...(hasPlate ? [{ id: "plate" as const, label: "3D Plate" }] : []),
            ]}
          />
          <TabPanel idPrefix="view" id={view} selected={view}>
            <div className="app-view">
              {view === "source" && <SourceView />}
              {view === "vector" && <VectorView backdrop={backdrop} setBackdrop={setBackdrop} />}
              {view === "fit" && <FitView backdrop={backdrop} setBackdrop={setBackdrop} />}
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
