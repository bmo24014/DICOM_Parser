import { useEffect, useRef, useState } from "react";
import type { ClinicalContext } from "../domain";
import { checkAIAvailability, generateAISummary } from "../data/aiSuggestions";
import {
  hasSummarySource,
  sourceFingerprint,
  sourceKey,
  summarySource,
} from "../data/summarySource";

type AcceptedProvenance = Extract<
  ClinicalContext["summaryProvenance"],
  { model: string }
>;
type Source = ReturnType<typeof summarySource>;
type Proposal = {
  originalText: string;
  text: string;
  model: string;
  generatedAt: string;
  source: Source;
  sourceKey: string;
  fingerprint: string;
  previousSummary: string;
};
type Request = {
  id: number;
  kind: "check" | "generate";
  controller: AbortController;
};

/** Unaccepted proposals are session-only and never enter the saved report. */
export default function AISummaryAssistant({
  context,
  onAccept,
}: {
  context: ClinicalContext;
  onAccept: (
    text: string,
    provenance: AcceptedProvenance,
    expectedSummary: string,
  ) => void;
}) {
  const [busy, setBusy] = useState<"check" | "generate" | null>(null);
  const [message, setMessage] = useState(
    "Local AI not checked. Manual summary editing is always available.",
  );
  const [error, setError] = useState(false);
  const [model, setModel] = useState<string>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [stale, setStale] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const latestContext = useRef(context);
  latestContext.current = context;
  const active = useRef<Request | null>(null);
  const sequence = useRef(0);
  const baseline = useRef<{ key: string; summary: string } | null>(null);
  const source = summarySource(context);
  const key = sourceKey(source);
  const hasSource = hasSummarySource(source);

  useEffect(
    () => () => {
      sequence.current++;
      active.current?.controller.abort();
      active.current = null;
    },
    [],
  );

  // A change permanently invalidates this attempt, including change-then-revert.
  // The same checks also run synchronously on response and acceptance.
  useEffect(() => {
    const started = baseline.current;
    if (
      !started ||
      (started.key === key && started.summary === context.summary)
    )
      return;
    if (active.current?.kind === "generate") {
      sequence.current++;
      active.current.controller.abort();
      active.current = null;
      setBusy(null);
    }
    setStale(true);
    setReviewed(false);
    setError(false);
    setMessage(
      started.key !== key
        ? "Source context changed. Regenerate the AI summary before acceptance."
        : "Patient summary changed. Regenerate before replacing your newer summary.",
    );
  }, [key, context.summary]);

  function isCurrent(request: Request) {
    return (
      active.current === request &&
      sequence.current === request.id &&
      !request.controller.signal.aborted
    );
  }

  function cancel() {
    sequence.current++;
    active.current?.controller.abort();
    active.current = null;
    if (!proposal) baseline.current = null;
    setBusy(null);
    setReviewed(false);
    setError(false);
    setMessage("Request cancelled. Your saved summary is unchanged.");
  }

  async function check() {
    if (active.current) return;
    const request: Request = {
      id: ++sequence.current,
      kind: "check",
      controller: new AbortController(),
    };
    active.current = request;
    setBusy("check");
    setError(false);
    setMessage("Checking the local Ollama server and configured model…");
    try {
      const result = await checkAIAvailability({
        signal: request.controller.signal,
      });
      if (!isCurrent(request)) return;
      setModel(result.model);
      setMessage(
        `Local AI ready — ${result.model}. Nothing is sent until you generate a summary.`,
      );
    } catch (cause) {
      if (!isCurrent(request)) return;
      setModel(undefined);
      setError(true);
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Local AI is unavailable. Manual summary editing remains available.",
      );
    } finally {
      if (active.current === request) {
        active.current = null;
        setBusy(null);
      }
    }
  }

  async function generate() {
    if (active.current) return;
    const current = latestContext.current;
    const input = summarySource(current);
    if (!hasSummarySource(input)) return;
    const capturedKey = sourceKey(input);
    const previousSummary = current.summary;
    const request: Request = {
      id: ++sequence.current,
      kind: "generate",
      controller: new AbortController(),
    };
    active.current = request;
    baseline.current = { key: capturedKey, summary: previousSummary };
    setBusy("generate");
    setProposal(null);
    setStale(false);
    setReviewed(false);
    setError(false);
    setMessage(
      "Generating a local AI draft… The first request may take time while Ollama loads the model.",
    );
    try {
      const result = await generateAISummary(input, {
        signal: request.controller.signal,
      });
      if (!isCurrent(request)) return;
      if (
        sourceKey(summarySource(latestContext.current)) !== capturedKey ||
        latestContext.current.summary !== previousSummary
      ) {
        setStale(true);
        setMessage(
          "Context or Patient summary changed. Regenerate before acceptance.",
        );
        return;
      }
      setModel(result.model);
      setProposal({
        originalText: result.text,
        text: result.text,
        model: result.model,
        generatedAt: result.generatedAt,
        source: input,
        sourceKey: capturedKey,
        fingerprint: sourceFingerprint(input),
        previousSummary,
      });
      setMessage(
        "Proposed summary ready for review. Patient summary has not been changed.",
      );
    } catch (cause) {
      if (!isCurrent(request)) return;
      baseline.current = null;
      setError(true);
      setMessage(
        cause instanceof Error
          ? cause.message
          : "AI generation failed. Your report and saved summary are unchanged.",
      );
    } finally {
      if (active.current === request) {
        active.current = null;
        setBusy(null);
      }
    }
  }

  function discard() {
    baseline.current = null;
    setProposal(null);
    setReviewed(false);
    setStale(false);
    setError(false);
    setMessage("AI proposal discarded. Your saved summary is unchanged.");
  }

  function accept() {
    if (
      !proposal ||
      !reviewed ||
      stale ||
      active.current ||
      !proposal.text.trim()
    )
      return;
    const current = latestContext.current;
    if (
      sourceKey(summarySource(current)) !== proposal.sourceKey ||
      current.summary !== proposal.previousSummary
    ) {
      setStale(true);
      setReviewed(false);
      setMessage(
        "Context or Patient summary changed. Regenerate before acceptance.",
      );
      return;
    }
    onAccept(
      proposal.text,
      {
        origin:
          proposal.text === proposal.originalText
            ? "ai-assisted"
            : "edited-ai-assisted",
        model: proposal.model,
        generatedAt: proposal.generatedAt,
        acceptance: "user-accepted",
        sourceFingerprint: proposal.fingerprint,
      },
      proposal.previousSummary,
    );
    baseline.current = null;
    setProposal(null);
    setReviewed(false);
    setStale(false);
    setError(false);
    setMessage(
      "AI-assisted summary accepted into Patient summary. You can edit it further.",
    );
  }

  return (
    <div
      className="ai-summary-assistant"
      aria-label="Local AI summary assistant"
    >
      <div className="button-row">
        <button type="button" onClick={() => void check()} disabled={!!busy}>
          Check local AI
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => void generate()}
          disabled={!!busy || !hasSource}
        >
          Generate AI Summary
        </button>
        {busy && (
          <button type="button" onClick={cancel}>
            {busy === "generate" ? "Cancel generation" : "Cancel request"}
          </button>
        )}
      </div>
      <p className="small quiet">
        Only clinical history, indication, and additional notes go to your local
        model. Images, the case-identifier field, findings, and the saved
        summary are excluded. Free text is sent as entered; remove identifying
        details first. AI can omit or invent information; compare every draft
        with its source.
      </p>
      <p
        className={error ? "message error" : "message"}
        role={error ? "alert" : "status"}
        aria-live="polite"
      >
        {message}
      </p>
      {!hasSource && (
        <p className="small quiet">
          Enter clinical history, an indication, or notes to enable generation.
        </p>
      )}
      {model && (
        <p className="small quiet">Configured / responding model: {model}</p>
      )}
      {proposal && (
        <section
          className="ai-proposal"
          aria-label="AI-generated summary proposal"
        >
          <h3>AI-generated draft — review before use</h3>
          <p className="small">Model: {proposal.model}</p>
          <div className="ai-review-grid">
            <label>
              Proposed AI summary
              <textarea
                rows={5}
                maxLength={10000}
                value={proposal.text}
                onChange={(event) => {
                  setProposal({ ...proposal, text: event.target.value });
                  setReviewed(false);
                }}
              />
            </label>
            <div className="ai-source-context">
              <h4>Source context used for this draft</h4>
              <dl>
                <dt>Clinical history</dt>
                <dd className="preserve-text">
                  {proposal.source.history || "Not provided."}
                </dd>
                <dt>Indication</dt>
                <dd className="preserve-text">
                  {proposal.source.indication || "Not provided."}
                </dd>
                <dt>Additional notes</dt>
                <dd className="preserve-text">
                  {proposal.source.notes || "Not provided."}
                </dd>
              </dl>
            </div>
          </div>
          {stale && (
            <p className="message warning">
              This proposal is stale. Regenerate it using the current context
              before acceptance.
            </p>
          )}
          <p className="small">
            Accepting replaces the current Patient summary. Unaccepted proposals
            are not included in PDF or JSON exports.
          </p>
          <label className="check-label">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={stale || !!busy}
              onChange={(event) => setReviewed(event.target.checked)}
            />{" "}
            I reviewed this AI draft and want to replace Patient summary.
          </label>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={!reviewed || stale || !!busy || !proposal.text.trim()}
              onClick={accept}
            >
              Accept AI summary
            </button>
            <button type="button" disabled={!!busy} onClick={discard}>
              Discard AI summary
            </button>
            <button
              type="button"
              disabled={!!busy || !hasSource}
              onClick={() => void generate()}
            >
              Regenerate AI summary
            </button>
          </div>
        </section>
      )}
      {stale && !proposal && (
        <button
          type="button"
          disabled={!!busy || !hasSource}
          onClick={() => void generate()}
        >
          Regenerate AI summary
        </button>
      )}
    </div>
  );
}
