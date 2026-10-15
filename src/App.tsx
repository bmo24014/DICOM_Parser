import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { Finding, Report, Study } from "./domain";
import { demoReport } from "./data/demo";
import { createFinding, parseReport, serializeReport } from "./data/reports";
import { importLocalDicom } from "./data/dicom";
import ViewerBoundary from "./components/ViewerBoundary";

const DicomViewer = lazy(() => import("./components/DicomViewer"));
const purpose =
  "This application is an early-stage research prototype designed to explore how shoulder MRI imaging, clinical context, and structured reporting can be integrated into a unified workspace. The current version focuses on interactive image review, simulated patient histories, and editable findings. Future development will investigate AI-assisted clinical summaries and image-based guidance while preserving clinician oversight.";

function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        S<span> / </span>M
      </span>
      <span>
        Shoulder MRI <strong>Workspace</strong>
      </span>
    </span>
  );
}

function Landing({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <header className="site-header">
        <Brand />
        <span className="stage-label">
          Research prototype <span className="status-dot" /> In development
        </span>
      </header>
      <main className="landing">
        <div className="eyebrow">IMAGING · CONTEXT · STRUCTURED FINDINGS</div>
        <div className="hero-grid">
          <section>
            <h1>
              A considered space
              <br />
              for shoulder MRI review.
            </h1>
            <p className="hero-intro">
              Explore the connection between images, clinical context, and clear
              reporting.
            </p>
            <button className="primary large" onClick={onOpen}>
              Open Workspace <span aria-hidden="true">→</span>
            </button>
            <p className="quiet small">
              Demo available immediately. No account or dataset required.
            </p>
          </section>
          <aside className="stage-card">
            <span className="eyebrow">CURRENT MILESTONE / 01</span>
            <h2>A working foundation.</h2>
            <p>
              Local DICOM review, fictional histories, and editable findings in
              one browser workspace.
            </p>
            <dl>
              <div>
                <dt>Data handling</dt>
                <dd>On your device</dd>
              </div>
              <div>
                <dt>Reporting</dt>
                <dd>Editable JSON</dd>
              </div>
              <div>
                <dt>AI assistance</dt>
                <dd>Future research</dd>
              </div>
            </dl>
            <span className="badge warning">Not for clinical use</span>
          </aside>
        </div>
        <section className="purpose">
          <span className="eyebrow">ABOUT THIS PROTOTYPE</span>
          <p>{purpose}</p>
        </section>
        <div className="feature-grid">
          <article>
            <span className="feature-number">01</span>
            <h3>Review locally</h3>
            <p>
              Import your own permitted, de-identified DICOM files. Image bytes
              stay in this browser session.
            </p>
          </article>
          <article>
            <span className="feature-number">02</span>
            <h3>Keep context visible</h3>
            <p>
              Read an explicitly fictional history alongside the images,
              separate from image-derived evidence.
            </p>
          </article>
          <article>
            <span className="feature-number">03</span>
            <h3>Make findings editable</h3>
            <p>
              Draft, review, and export structured observations. Every entry
              keeps its source visible.
            </p>
          </article>
        </div>
        <footer className="landing-footer">
          <span>
            Educational research · No diagnostic AI · No clinical
            recommendations
          </span>
          <span>Local-first / v0.1</span>
        </footer>
      </main>
    </>
  );
}

function FindingEditor({
  finding,
  index,
  onChange,
  onDelete,
}: {
  finding: Finding;
  index: number;
  onChange: (patch: Partial<Finding>) => void;
  onDelete: () => void;
}) {
  return (
    <article className="finding-card">
      <div className="section-heading">
        <h3>Finding {index + 1}</h3>
        <button
          className="text-button danger"
          onClick={onDelete}
          aria-label={`Delete finding ${index + 1}`}
        >
          Delete
        </button>
      </div>
      <label>
        Anatomical structure
        <input
          value={finding.structure}
          maxLength={200}
          onChange={(e) => onChange({ structure: e.target.value })}
          placeholder="e.g. Supraspinatus tendon"
        />
      </label>
      <label>
        Observation
        <textarea
          value={finding.observation}
          maxLength={5000}
          onChange={(e) => onChange({ observation: e.target.value })}
          placeholder="Enter an observation for review"
          rows={3}
        />
      </label>
      <div className="form-row">
        <label>
          Laterality
          <select
            value={finding.laterality}
            onChange={(e) =>
              onChange({ laterality: e.target.value as Finding["laterality"] })
            }
          >
            <option value="unspecified">Unspecified</option>
            <option value="left">Left</option>
            <option value="right">Right</option>
            <option value="bilateral">Bilateral</option>
          </select>
        </label>
        <label>
          Review status
          <select
            value={finding.reviewStatus}
            onChange={(e) =>
              onChange({
                reviewStatus: e.target.value as Finding["reviewStatus"],
              })
            }
          >
            <option value="draft">Draft</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>
      </div>
      <label>
        Source
        <select
          value={finding.source}
          onChange={(e) =>
            onChange({ source: e.target.value as Finding["source"] })
          }
        >
          <option value="clinician entered">Clinician entered</option>
          <option value="dataset label">Dataset label</option>
          <option value="simulated">Simulated</option>
        </select>
      </label>
      <label>
        Note <span className="quiet">(optional)</span>
        <input
          value={finding.note ?? ""}
          maxLength={10000}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>
    </article>
  );
}

function Workspace({ onHome }: { onHome: () => void }) {
  const [mode, setMode] = useState<"demo" | "local">("demo");
  const [report, setReport] = useState<Report>(() =>
    structuredClone(demoReport),
  );
  const [studies, setStudies] = useState<Study[]>([]);
  const [studyId, setStudyId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const study = studies.find((item) => item.id === studyId);
  const series = study?.series.find((item) => item.id === seriesId) ?? null;

  async function importImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setLoading(true);
    setError("");
    setNotice("");
    setWarnings([]);
    try {
      const result = await importLocalDicom(files);
      if (!result.studies.length)
        throw new Error(
          "No readable image instances were found. Select DICOM image files; ZIP archives and DICOMDIR are not supported.",
        );
      setStudies(result.studies);
      setStudyId(result.studies[0].id);
      setSeriesId(result.studies[0].series[0]?.id ?? "");
      setWarnings(result.warnings);
      setMode("local");
      setNotice(
        `Loaded ${result.studies.length} study group(s) locally. Existing report content is unchanged and is not linked to these images.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not read these files.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    try {
      if (file.size > 1_000_000)
        throw new Error("Report files must be smaller than 1 MB.");
      const next = parseReport(await file.text());
      setReport(next);
      setNotice(
        "Report imported. Image selection is unchanged; verify any study reference before using it.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid report JSON.");
    }
  }

  function exportJson() {
    try {
      const blob = new Blob([serializeReport(report)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "shoulder-workspace-report.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        "Report exported as prototype JSON. This is not DICOM Structured Reporting.",
      );
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not export report.",
      );
    }
  }

  function updateFinding(id: string, patch: Partial<Finding>) {
    setReport((current) => ({
      ...current,
      findings: current.findings.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  return (
    <>
      <header className="site-header workspace-header">
        <button
          className="brand-button"
          onClick={onHome}
          aria-label="Go to overview"
        >
          <Brand />
        </button>
        <div className="header-labels">
          <span className="badge">Research prototype</span>
          <span className="badge warning">Not for clinical use</span>
        </div>
      </header>
      <main className="workspace">
        <div className="workspace-title">
          <div>
            <div className="eyebrow">RESEARCH WORKSPACE</div>
            <h1>Shoulder review</h1>
          </div>
          <p className="quiet small">
            Session only · Export to keep your work
            <br />
            No uploads or third-party telemetry
          </p>
        </div>
        <div className="workspace-toolbar">
          <div className="mode-switch" role="group" aria-label="Data mode">
            <button
              className={mode === "demo" ? "active" : ""}
              onClick={() => setMode("demo")}
            >
              Demo mode
            </button>
            <button
              className={mode === "local" ? "active" : ""}
              onClick={() => setMode("local")}
            >
              Local DICOM import
            </button>
          </div>
          <div className="button-row">
            <button
              onClick={() => fileInput.current?.click()}
              disabled={loading}
            >
              Select DICOM files
            </button>
            <button
              onClick={() => folderInput.current?.click()}
              disabled={loading}
            >
              Select folder
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={importImages}
            aria-label="Select DICOM files"
          />
          <input
            ref={folderInput}
            type="file"
            multiple
            {...{ webkitdirectory: "" }}
            hidden
            onChange={importImages}
            aria-label="Select DICOM folder"
          />
        </div>
        <div className="privacy-note">
          Use only permitted, de-identified data. Files are read locally without
          alteration. Importing images does not connect them to the fictional
          context or report.
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
          </div>
        )}
        {!!warnings.length && (
          <details className="message warning">
            <summary>Import notes ({warnings.length})</summary>
            <ul>
              {warnings.slice(0, 30).map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
            {warnings.length > 30 && <p>Additional files were skipped.</p>}
          </details>
        )}
        <div className="workspace-grid">
          <section className="imaging-column" aria-label="Image review">
            <div className="panel image-panel">
              <div className="panel-heading">
                <h2>Image review</h2>
                <span className="panel-meta">
                  {mode === "demo" ? "NO DEMO IMAGES" : "LOCAL FILES"}
                </span>
              </div>
              {mode === "local" && (
                <div className="study-controls">
                  <label>
                    Study
                    <select
                      aria-label="Study"
                      value={studyId}
                      onChange={(e) => {
                        const next = studies.find(
                          (item) => item.id === e.target.value,
                        );
                        setStudyId(e.target.value);
                        setSeriesId(next?.series[0]?.id ?? "");
                      }}
                      disabled={!studies.length}
                    >
                      <option value="" disabled>
                        No study selected
                      </option>
                      {studies.map((item, i) => (
                        <option key={item.id} value={item.id}>
                          Study {i + 1} · {item.series.length} series
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Series
                    <select
                      aria-label="Series"
                      value={seriesId}
                      onChange={(e) => setSeriesId(e.target.value)}
                      disabled={!study}
                    >
                      <option value="" disabled>
                        No series selected
                      </option>
                      {study?.series.map((item, i) => (
                        <option key={item.id} value={item.id}>
                          Series {i + 1} · {item.modality || "Image"} ·{" "}
                          {item.instances.length} files
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {loading ? (
                <div className="image-empty" role="status">
                  <span className="canvas-cross" aria-hidden="true">
                    ＋
                  </span>
                  <h3>Reading local metadata…</h3>
                  <p>Grouping image files into studies and series.</p>
                </div>
              ) : mode === "local" && series ? (
                <ViewerBoundary key={series.id}>
                  <Suspense
                    fallback={
                      <div className="image-empty" role="status">
                        Loading DICOM renderer…
                      </div>
                    }
                  >
                    <DicomViewer series={series} />
                  </Suspense>
                </ViewerBoundary>
              ) : (
                <div className="image-empty">
                  <div className="canvas-cross" aria-hidden="true">
                    ＋
                  </div>
                  <span className="eyebrow">DICOM VIEWPORT</span>
                  <h3>Import DICOM to test viewer</h3>
                  <p>
                    {mode === "demo"
                      ? "Demo mode includes fictional context and editable findings. No MRI images are bundled."
                      : "Choose a folder or multiple image files from your computer to begin."}
                  </p>
                  <button
                    className="canvas-button"
                    onClick={() => fileInput.current?.click()}
                  >
                    Choose local files
                  </button>
                  <span className="small">
                    No image or diagnostic result is simulated here.
                  </span>
                </div>
              )}
            </div>
            <section className="panel context-panel">
              <div className="panel-heading">
                <h2>Clinical context</h2>
                <span className="badge">
                  {report.clinicalContext.fictional
                    ? "Fictional example"
                    : "Imported · unverified"}
                </span>
              </div>
              <div className="panel-body">
                <div className="context-heading">
                  <span className="context-icon" aria-hidden="true">
                    ≡
                  </span>
                  <div>
                    <h3>
                      {report.clinicalContext.fictional
                        ? "Synthetic case history"
                        : "Imported report context"}
                    </h3>
                    <p className="quiet small">
                      Manually authored · Not derived from images
                    </p>
                  </div>
                </div>
                <p className="preserve-text">
                  {report.clinicalContext.history}
                </p>
                <div className="context-summary">
                  <span className="eyebrow">CONTEXT SUMMARY</span>
                  <p className="preserve-text">
                    {report.clinicalContext.summary}
                  </p>
                </div>
                <p className="small quiet">
                  This context is separate from the selected images. AI
                  summaries and clinician-reviewed areas of interest are future
                  research features.
                </p>
              </div>
            </section>
            <p className="small quiet image-footnote">
              Review controls apply to supported DICOM images. Compressed
              formats and unusual transfer syntaxes may be unsupported; decoder
              errors are shown in the viewport.
            </p>
          </section>
          <section
            className="panel findings-panel"
            aria-label="Structured findings"
          >
            <div className="panel-heading">
              <h2>
                Structured findings{" "}
                <span className="count">{report.findings.length}</span>
              </h2>
              <span className="panel-meta">EDITABLE DRAFT</span>
            </div>
            <div className="panel-body">
              <p className="small quiet">
                Entries are authored or imported; this app does not detect
                pathology. “Reviewed” is a user-set workflow label, not clinical
                approval.
              </p>
              {report.studyInstanceUID && (
                <p className="message warning small">
                  This report contains a study UID reference. Its relationship
                  to the selected images has not been verified.
                </p>
              )}
              <div className="button-row report-actions">
                <button onClick={() => jsonInput.current?.click()}>
                  Import JSON
                </button>
                <button className="primary" onClick={exportJson}>
                  Export JSON ↓
                </button>
                <input
                  ref={jsonInput}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={importJson}
                  aria-label="Import report JSON"
                />
              </div>
              <p className="small quiet">
                Import replaces the report. Export your edits first.
              </p>
              <div className="findings-list">
                {report.findings.map((finding, i) => (
                  <FindingEditor
                    key={finding.id}
                    finding={finding}
                    index={i}
                    onChange={(patch) => updateFinding(finding.id, patch)}
                    onDelete={() =>
                      setReport((current) => ({
                        ...current,
                        findings: current.findings.filter(
                          (item) => item.id !== finding.id,
                        ),
                      }))
                    }
                  />
                ))}
              </div>
              {!report.findings.length && (
                <p className="empty-findings">
                  No findings yet. Add an entry to begin a draft.
                </p>
              )}
              <button
                className="add-finding"
                disabled={report.findings.length >= 1000}
                onClick={() =>
                  setReport((current) => ({
                    ...current,
                    findings: [...current.findings, createFinding()],
                  }))
                }
              >
                ＋ Add finding
              </button>
              <p className="small quiet report-footer">
                Prototype JSON only. DICOM SR / TID 1500 export is a future
                feature. Work is held in memory until you export it.
              </p>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

export default function App() {
  const [open, setOpen] = useState(() => window.location.hash === "#workspace");
  useEffect(() => {
    const onHash = () => setOpen(window.location.hash === "#workspace");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Keep the workspace mounted when navigating to the overview so in-session edits survive.
  return (
    <>
      <div hidden={open}>
        <Landing
          onOpen={() => {
            window.location.hash = "workspace";
          }}
        />
      </div>
      <div hidden={!open}>
        <Workspace
          onHome={() => {
            window.location.hash = "";
          }}
        />
      </div>
    </>
  );
}
