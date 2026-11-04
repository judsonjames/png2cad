import { AppHeader, DropPanel, Pane, SchemePicker, Workspace } from "@png2cad/ui/components";
import { applyScheme, DEFAULT_SCHEME, toScheme, type Scheme } from "@png2cad/ui/scheme";
import { useEffect, useState } from "react";
import { ExportPanel } from "./panels/ExportPanel";
import { OutputPanel } from "./panels/OutputPanel";
import { SizePanel } from "./panels/SizePanel";
import { TracePanel } from "./panels/TracePanel";
import { useApp } from "./store";
import { Stage } from "./views/Stage";

const SAVED_SCHEME = "png2cad.scheme";

function savedScheme(): Scheme {
  try {
    return toScheme(JSON.parse(localStorage.getItem(SAVED_SCHEME) ?? "null"));
  } catch {
    return DEFAULT_SCHEME;
  }
}

export function App() {
  const hasImage = useApp((s) => s.image !== null);
  const loadImage = useApp((s) => s.loadImage);
  const [scheme, setScheme] = useState(savedScheme);
  useEffect(() => {
    applyScheme(scheme);
    try {
      localStorage.setItem(SAVED_SCHEME, JSON.stringify(scheme));
    } catch {
      // Browser storage is a convenience.
    }
  }, [scheme]);

  // Paste an image from anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) void loadImage(file, file.name || "pasted");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadImage]);

  return (
    <div className="app">
      <AppHeader subtitle="Image to DXF, SVG and 3MF">
        <div className="app-header-end">
          <span className="app-local">Runs in your browser. Your image is never uploaded.</span>
          <DropPanel label="Color Scheme" button="Color Scheme">
            {() => <SchemePicker value={scheme} onChange={setScheme} />}
          </DropPanel>
        </div>
      </AppHeader>
      <Workspace always columns="minmax(0, 1fr) 24rem">
        <Pane label="Picture" className="app-stage-pane">
          <Stage />
        </Pane>
        <Pane label="Settings" className="app-settings">
          {hasImage && (
            <>
              <div className="app-settings-scroll">
                <TracePanel />
                <SizePanel />
                <OutputPanel />
              </div>
              <ExportPanel />
            </>
          )}
          {!hasImage && <Intro />}
        </Pane>
      </Workspace>
    </div>
  );
}

function Intro() {
  return (
    <section className="p2c-section app-intro">
      <h2>What You Get</h2>
      <ul>
        <li>
          <strong>SVG</strong> for Affinity, Illustrator and printing on products. Filled shapes that scale to any size,
          one layer per color.
        </li>
        <li>
          <strong>DXF</strong> for Onshape and other CAD. Every area selects as one region, ready to extrude.
        </li>
        <li>
          <strong>3MF</strong> plates for Bambu Studio and Orca Slicer, with each color on its own filament.
        </li>
      </ul>
      <p className="p2c-help">
        Works best on line art and flat-color logos. Lines and gaps are fitted to your nozzle, and every file is read
        back and checked before you download it.
      </p>
    </section>
  );
}
