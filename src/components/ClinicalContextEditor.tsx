import type { Dispatch, SetStateAction } from "react";
import type { ClinicalContext, Report } from "../domain";

export default function ClinicalContextEditor({
  report,
  setReport,
}: {
  report: Report;
  setReport: Dispatch<SetStateAction<Report>>;
}) {
  const context = report.clinicalContext;
  const update = (patch: Partial<ClinicalContext>) =>
    setReport((current) => ({
      ...current,
      clinicalContext: {
        ...current.clinicalContext,
        ...patch,
        provenance: "manual",
      },
    }));
  return (
    <section
      className="panel context-panel"
      id="clinical-context"
      aria-label="Clinical context"
    >
      <div className="panel-heading">
        <h2>Clinical context</h2>
        <span className="badge">
          {context.provenance === "simulated"
            ? "Simulated"
            : context.provenance === "imported"
              ? "Imported"
              : "Manually entered"}
          {context.fictional ? " · Fictional example" : ""}
        </span>
      </div>
      <div className="panel-body">
        <p className="small quiet">
          Use a fictional or de-identified case only. Context is authored by
          you, never inferred from images. Editing a field marks the context as
          manually entered.
        </p>
        <label>
          Case identifier
          <input
            value={context.caseIdentifier}
            maxLength={200}
            onChange={(e) => update({ caseIdentifier: e.target.value })}
            placeholder="Fictional or de-identified identifier"
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={context.fictional}
            onChange={(e) => update({ fictional: e.target.checked })}
          />{" "}
          This is fictional context
        </label>
        <label>
          Clinical history
          <textarea
            value={context.history}
            rows={4}
            maxLength={20000}
            onChange={(e) => update({ history: e.target.value })}
          />
        </label>
        <label>
          Reason for examination / indication
          <textarea
            value={context.indication}
            rows={2}
            maxLength={10000}
            onChange={(e) => update({ indication: e.target.value })}
          />
        </label>
        <label>
          Patient summary
          <textarea
            value={context.summary}
            rows={3}
            maxLength={10000}
            onChange={(e) => update({ summary: e.target.value })}
          />
        </label>
        <label>
          Relevant symptoms / additional notes
          <textarea
            value={context.notes}
            rows={3}
            maxLength={20000}
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>
        <p className="small quiet">
          The fictional example remains available in the initial demo. Changing
          image selection never replaces this context. Future AI summaries are
          not implemented.
        </p>
      </div>
    </section>
  );
}
