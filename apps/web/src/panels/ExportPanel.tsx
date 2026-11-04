import type { Finding } from "@png2cad/formats";
import { Banner, Button, CheckList, Progress, Section, Verdict, type CheckItem } from "@png2cad/ui/components";
import { download, useApp, zipFiles } from "../store";

const STATE = { pass: "pass", warning: "warn", fault: "fail" } as const;

function items(findings: Finding[]): CheckItem[] {
  return findings.map((f, i) => ({ id: `${f.code}-${i}`, label: f.message, state: STATE[f.severity] }));
}

function sizeOf(bytes: number): string {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

/** The screen's one primary action, and what came of it. */
export function ExportPanel() {
  const s = useApp((st) => st.settings);
  const busy = useApp((st) => st.exportBusy);
  const step = useApp((st) => st.exportStep);
  const error = useApp((st) => st.exportError);
  const result = useApp((st) => st.result);
  const title = useApp((st) => st.title);
  const palette = useApp((st) => st.palette);
  const exportFiles = useApp((st) => st.exportFiles);
  const cancelExport = useApp((st) => st.cancelExport);
  const nothing = !s.makeSvg && !s.makeDxf && !s.makePlate;
  const faults = result?.findings.filter((f) => f.severity === "fault").length ?? 0;
  const warnings = result?.findings.filter((f) => f.severity === "warning").length ?? 0;
  return (
    <Section title="Export" className="app-export-panel">
      {!busy && !result && (
        <Button
          variant="primary"
          className="app-export"
          disabled={nothing || !s.size || palette.length < 2}
          onClick={() => void exportFiles()}
        >
          Make Files
        </Button>
      )}
      {nothing && <p className="p2c-help">Turn on at least one file above.</p>}
      {busy && step && (
        <>
          <Progress label={step.message} value={step.done} />
          <Button onClick={cancelExport}>Cancel</Button>
        </>
      )}
      {error && (
        <Banner kind="danger" title="The files were not made">
          {error}
        </Banner>
      )}
      {result && (
        <>
          <Verdict
            state={faults ? "fail" : warnings ? "warn" : "pass"}
            title={faults ? "Do Not Use These Files Yet" : warnings ? "Ready, with Notes" : "Ready"}
            detail={
              faults
                ? `${faults} ${faults === 1 ? "check" : "checks"} failed. See below.`
                : "Every file was read back and checked."
            }
          />
          <CheckList items={items(result.findings)} label="File Checks" />
          <ul className="app-files" aria-label="Files">
            {result.files.map((f) => (
              <li key={f.name}>
                <span className="app-file-name">{f.name}</span>
                <span className="app-file-size">{sizeOf(f.bytes.length)}</span>
                <Button aria-label={`Download ${f.name}`} onClick={() => download(f.name, f.bytes)}>
                  Download
                </Button>
              </li>
            ))}
          </ul>
          {result.files.length > 1 && (
            <Button variant="primary" className="app-export" onClick={() => download(`${title}.zip`, zipFiles(result))}>
              {`Download All (${result.files.length} Files)`}
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
