import type { Dispatch, SetStateAction } from "react";
import type { ClinicalContext, Report } from "../domain";
import AISummaryAssistant from "./AISummaryAssistant";
import { sourceFingerprint, summarySource } from "../data/summarySource";

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
  const summaryProvenance = context.summaryProvenance;
  const aiSummary = "model" in summaryProvenance ? summaryProvenance : null;
  const sourceChanged =
    !!aiSummary &&
    aiSummary.sourceFingerprint !== sourceFingerprint(summarySource(context));
  const editSummary = (summary: string) =>
    setReport((current) => ({
      ...current,
      clinicalContext: {
        ...current.clinicalContext,
        summary,
        summaryProvenance:
          "model" in current.clinicalContext.summaryProvenance
            ? {
                ...current.clinicalContext.summaryProvenance,
                origin: "edited-ai-assisted",
              }
            : { origin: "manual" },
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
            onChange={(e) => editSummary(e.target.value)}
          />
        </label>
        <p className="small quiet summary-provenance">
          {aiSummary ? (
            <>
              {aiSummary.origin === "edited-ai-assisted"
                ? "Edited AI-assisted summary"
                : "AI-assisted summary"}{" "}
              · Model: {aiSummary.model} · User-accepted · Generated{" "}
              {aiSummary.generatedAt}
            </>
          ) : summaryProvenance.origin === "manual" ? (
            "Summary source: manually authored."
          ) : (
            "Summary source: legacy draft; AI origin is not established."
          )}
        </p>
        {sourceChanged && (
          <p className="message warning">
            Source context has changed since this AI-assisted summary was
            generated. Review the saved summary or generate a new draft.
          </p>
        )}
        <AISummaryAssistant
          context={context}
          onAccept={(summary, provenance, expectedSummary) =>
            setReport((current) => {
              if (
                sourceFingerprint(summarySource(current.clinicalContext)) !==
                  provenance.sourceFingerprint ||
                current.clinicalContext.summary !== expectedSummary
              )
                return current;
              return {
                ...current,
                clinicalContext: {
                  ...current.clinicalContext,
                  summary,
                  summaryProvenance: provenance,
                },
              };
            })
          }
        />
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
          image selection never replaces this context. The local AI assistant
          summarizes supplied text only and does not interpret MRI images.
        </p>
      </div>
    </section>
  );
}
