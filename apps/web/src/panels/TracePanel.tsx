import type { Rgb } from "@png2cad/core";
import {
  Banner,
  Button,
  Disclosure,
  Field,
  InfoTip,
  NumberInput,
  Section,
  Switch,
  ToggleGroup,
} from "@png2cad/ui/components";
import { useApp } from "../store";

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const fromHex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

/** How the image becomes shapes. */
export function TracePanel() {
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.update);
  const palette = useApp((s) => s.palette);
  const setPalette = useApp((s) => s.setPalette);
  const clearImage = useApp((s) => s.clearImage);
  const title = useApp((s) => s.title);
  const stats = useApp((s) => s.preview?.colors);
  const setColor = (i: number, hex: string) => setPalette(palette.map((c, k) => (k === i ? fromHex(hex) : c)));
  const remove = (i: number) => setPalette(palette.filter((_, k) => k !== i));
  const lines = settings.mode === "mask";
  const crop = useApp((s) => s.crop);
  const imageWidth = useApp((s) => s.image?.width ?? 0);
  const usedWidth = crop ? crop.x1 - crop.x0 : imageWidth;
  return (
    <Section
      title="Trace"
      meta={title}
      actions={
        <Button variant="quiet" onClick={clearImage}>
          Remove Image
        </Button>
      }
    >
      <ToggleGroup
        label="Trace Mode"
        value={settings.mode}
        onChange={(mode) => {
          update({ mode });
          if (mode === "mask" && palette.length > 2) setPalette(palette.slice(0, 2));
        }}
        options={[
          { value: "mask", label: "Line Art" },
          { value: "colors", label: "Flat Colors" },
        ]}
      />
      <div className="app-palette" role="group" aria-label="Colors">
        {palette.map((c, i) => (
          <div className="app-color" key={i}>
            <input
              type="color"
              value={toHex(c)}
              aria-label={i === 0 ? "Background Color" : `Color ${i}`}
              onChange={(e) => setColor(i, e.target.value)}
            />
            <span className="app-color-name">{i === 0 ? "Background" : lines ? "Art" : `Color ${i}`}</span>
            {!lines && i > 0 && stats?.[i - 1] && (
              <span className="app-color-share">{`${stats[i - 1].share.toFixed(stats[i - 1].share < 1 ? 1 : 0)}%`}</span>
            )}
            {!lines && i > 0 && palette.length > 2 && (
              <Button variant="quiet" aria-label={`Remove Color ${i}`} onClick={() => remove(i)}>
                ×
              </Button>
            )}
          </div>
        ))}
      </div>
      {!lines && (
        <>
          <p className="p2c-help">
            The outer background is left out. Use Pick a Color on the Source tab to add a color from the image.
          </p>
          <Switch
            label="Keep Enclosed Background"
            checked={settings.keepEnclosed}
            onChange={(keepEnclosed) => update({ keepEnclosed })}
            info="Background-colored areas inside the art become a color of their own. Without this, white parts of a logo on white are cut out, and a plate falls into loose pieces."
          />
        </>
      )}
      {!lines && usedWidth < 400 && (
        <Banner kind="warn" title={`Only ${usedWidth} pixels wide`}>
          Flat Colors needs about 400 pixels across, with lettering at least 20 pixels tall. Use a larger source if you
          have one, as small logos trace with rough edges.
        </Banner>
      )}
      <Disclosure summary="Trace Details">
        <Field
          label="Smallest Area"
          info="Areas smaller than a square of this side count as noise and merge into their surroundings."
        >
          <NumberInput
            unit="mm"
            value={settings.speckMm}
            min={0}
            onChange={(v) => v !== null && update({ speckMm: v })}
          />
        </Field>
        <Field
          label="Curve Tolerance"
          info="How far an SVG curve may stray from the traced edge. A larger value gives fewer nodes and smoother curves."
        >
          <NumberInput
            unit="mm"
            value={settings.tolMm}
            min={0.005}
            digits={3}
            onChange={(v) => v && update({ tolMm: v })}
          />
        </Field>
      </Disclosure>
      <span className="app-tip-row">
        Not what you expected?
        <InfoTip text="Works best on clean art. Crop away anything that is not the logo. A logo that shares a color with its background needs that color removed from the palette, or a cleaner source." />
      </span>
    </Section>
  );
}
