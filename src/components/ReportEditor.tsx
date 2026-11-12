import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  FINDING_CATEGORIES,
  LATERALITIES,
  type Finding,
  type FindingCategory,
  type ManualAnnotation,
  type Report,
  type Study,
} from "../domain";
import { createFinding } from "../data/reports";

type Props = {
  report: Report;
  setReport: Dispatch<SetStateAction<Report>>;
  study?: Study;
  confirmedStudyId?: string;
  onAssociate: () => void;
  onUnlink: () => void;
  selectedAnnotationId?: string;
  onNavigate: (annotation: ManualAnnotation) => void;
  onDeleteAnnotation: (id: string) => void;
};

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
        Anatomical category
        <select
          aria-label="Anatomical category"
          value={finding.category}
          onChange={(e) =>
            onChange({ category: e.target.value as FindingCategory })
          }
        >
          {FINDING_CATEGORIES.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </label>
      <label>
        Anatomical structure
        <input
          value={finding.structure}
          maxLength={200}
          onChange={(e) => onChange({ structure: e.target.value })}
          placeholder="Structure reviewed"
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
            aria-label="Laterality"
            value={finding.laterality}
            onChange={(e) =>
              onChange({ laterality: e.target.value as Finding["laterality"] })
            }
          >
            {LATERALITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Review status
          <select
            aria-label="Review status"
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
          aria-label="Source"
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
        Note (optional)
        <input
          value={finding.note ?? ""}
          maxLength={10000}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      </label>
    </article>
  );
}

export default function ReportEditor({
  report,
  setReport,
  study,
  confirmedStudyId,
  onAssociate,
  onUnlink,
  selectedAnnotationId,
  onNavigate,
  onDeleteAnnotation,
}: Props) {
  const [associationChecked, setAssociationChecked] = useState(false);
  useEffect(() => {
    setAssociationChecked(false);
  }, [study?.id, report.id]);
  function updateFinding(id: string, patch: Partial<Finding>) {
    setReport((current) => ({
      ...current,
      findings: current.findings.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }
  function removeFinding(id: string) {
    setReport((current) => ({
      ...current,
      findings: current.findings.filter((item) => item.id !== id),
      annotations: current.annotations.map((item) => {
        if (item.findingId !== id) return item;
        const { findingId: _removed, ...rest } = item;
        void _removed;
        return rest;
      }),
    }));
  }
  function updateAnnotation(id: string, patch: Partial<ManualAnnotation>) {
    setReport((current) => ({
      ...current,
      annotations: current.annotations.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }
  const studyHasUID = !!study && !study.id.startsWith("missing-");
  return (
    <div className="report-sections">
      <details className="report-section" open>
        <summary>A. Examination information</summary>
        <div className="section-content">
          <label>
            Examination type
            <input
              value={report.examination.type}
              maxLength={500}
              placeholder="Not provided"
              onChange={(e) =>
                setReport((current) => ({
                  ...current,
                  examination: { ...current.examination, type: e.target.value },
                }))
              }
            />
          </label>
          <div className="form-row">
            <label>
              Examination laterality
              <select
                aria-label="Examination laterality"
                value={report.examination.laterality}
                onChange={(e) =>
                  setReport((current) => ({
                    ...current,
                    examination: {
                      ...current.examination,
                      laterality: e.target.value as Finding["laterality"],
                    },
                  }))
                }
              >
                {LATERALITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Examination date
              <input
                type="date"
                value={report.examination.date}
                onChange={(e) =>
                  setReport((current) => ({
                    ...current,
                    examination: {
                      ...current.examination,
                      date: e.target.value,
                    },
                  }))
                }
              />
            </label>
          </div>
          <div className="association-box">
            {study && (
              <p className="small">
                Selected study UID: <span className="uid">{study.id}</span>
              </p>
            )}
            <p className="small">
              {report.studyInstanceUID ? (
                <>
                  Stored study reference:{" "}
                  <span className="uid">{report.studyInstanceUID}</span>
                  <br />
                  <strong>
                    {confirmedStudyId === report.studyInstanceUID
                      ? "Association confirmed in this session."
                      : "Imported or previously saved reference; verify before associating."}
                  </strong>
                </>
              ) : (
                "This report is not associated with an image study."
              )}
            </p>
            <p className="small quiet">
              Selecting images never associates the fictional context or report
              automatically. Verify the report and context before confirming.
            </p>
            {studyHasUID && (
              <>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={associationChecked}
                    onChange={(e) => setAssociationChecked(e.target.checked)}
                  />{" "}
                  I have verified this report and context belong with the
                  selected study.
                </label>
                <button
                  disabled={!associationChecked}
                  onClick={() => {
                    onAssociate();
                    setAssociationChecked(false);
                  }}
                >
                  Confirm study association
                </button>
              </>
            )}
            {report.studyInstanceUID && (
              <button className="text-button danger" onClick={onUnlink}>
                Remove study association
              </button>
            )}
            {report.studyInstanceUID &&
              study &&
              report.studyInstanceUID !== study.id && (
                <p className="small association-warning">
                  Selected images belong to a different study.
                </p>
              )}
          </div>
        </div>
      </details>
      <details className="report-section" open>
        <summary>B. Clinical history / indication</summary>
        <div className="section-content">
          <p className="small quiet">
            These fields share the editable clinical context alongside the
            images.
          </p>
          <label>
            Report indication
            <textarea
              rows={2}
              maxLength={10000}
              value={report.clinicalContext.indication}
              onChange={(e) =>
                setReport((current) => ({
                  ...current,
                  clinicalContext: {
                    ...current.clinicalContext,
                    indication: e.target.value,
                    provenance: "manual",
                  },
                }))
              }
            />
          </label>
          <p className="small preserve-text">
            {report.clinicalContext.history || "Not provided."}
          </p>
          <p className="small preserve-text">
            {report.clinicalContext.notes || "No additional notes provided."}
          </p>
          <button
            onClick={() =>
              document
                .getElementById("clinical-context")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Edit full context
          </button>
        </div>
      </details>
      <details className="report-section">
        <summary>C. Technique</summary>
        <div className="section-content">
          <label>
            MRI acquisition technique
            <textarea
              value={report.technique.acquisition}
              rows={3}
              maxLength={20000}
              placeholder="Not provided"
              onChange={(e) =>
                setReport((current) => ({
                  ...current,
                  technique: {
                    ...current.technique,
                    acquisition: e.target.value,
                  },
                }))
              }
            />
          </label>
          <label>
            Contrast information
            <textarea
              value={report.technique.contrast}
              rows={2}
              maxLength={10000}
              placeholder="Not provided"
              onChange={(e) =>
                setReport((current) => ({
                  ...current,
                  technique: { ...current.technique, contrast: e.target.value },
                }))
              }
            />
          </label>
        </div>
      </details>
      <details className="report-section">
        <summary>D. Comparison</summary>
        <div className="section-content">
          <label>
            Previous imaging studies
            <textarea
              value={report.comparison}
              rows={3}
              maxLength={20000}
              placeholder="Not provided"
              onChange={(e) =>
                setReport((current) => ({
                  ...current,
                  comparison: e.target.value,
                }))
              }
            />
          </label>
        </div>
      </details>
      <section className="report-section findings-section">
        <h3>E. Findings</h3>
        <p className="small quiet">
          Authored or imported observations only. No pathology is detected by
          this application.
        </p>
        {FINDING_CATEGORIES.map((category) => (
          <div className="finding-category" key={category}>
            <h4>{category}</h4>
            {report.findings
              .filter((item) => item.category === category)
              .map((finding) => (
                <div key={finding.id}>
                  <FindingEditor
                    finding={finding}
                    index={report.findings.indexOf(finding)}
                    onChange={(patch) => updateFinding(finding.id, patch)}
                    onDelete={() => removeFinding(finding.id)}
                  />
                  {report.annotations
                    .filter((item) => item.findingId === finding.id)
                    .map((item) => (
                      <button
                        className="annotation-jump"
                        key={item.id}
                        onClick={() => onNavigate(item)}
                      >
                        Show linked region:{" "}
                        {item.description || "Manual rectangle"}
                      </button>
                    ))}
                </div>
              ))}
            {!report.findings.some((item) => item.category === category) && (
              <p className="small quiet">No entries provided.</p>
            )}
            <button
              className="category-add"
              aria-label={`Add finding to ${category}`}
              disabled={report.findings.length >= 1000}
              onClick={() =>
                setReport((current) => ({
                  ...current,
                  findings: [...current.findings, createFinding(category)],
                }))
              }
            >
              ＋ Add {category.toLowerCase()} finding
            </button>
          </div>
        ))}
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
      </section>
      <section className="report-section">
        <h3>F. Impression</h3>
        <p className="small quiet">
          Manually authored summary statements. Nothing is generated from the
          images.
        </p>
        {report.impression.map((statement, index) => (
          <div className="impression-row" key={index}>
            <label>
              Impression {index + 1}
              <textarea
                rows={2}
                value={statement}
                maxLength={10000}
                onChange={(e) =>
                  setReport((current) => ({
                    ...current,
                    impression: current.impression.map((value, i) =>
                      i === index ? e.target.value : value,
                    ),
                  }))
                }
              />
            </label>
            <button
              className="text-button danger"
              aria-label={`Remove impression ${index + 1}`}
              onClick={() =>
                setReport((current) => ({
                  ...current,
                  impression: current.impression.filter((_, i) => i !== index),
                }))
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          disabled={report.impression.length >= 1000}
          onClick={() =>
            setReport((current) => ({
              ...current,
              impression: [...current.impression, ""],
            }))
          }
        >
          Add impression statement
        </button>
      </section>
      <section
        className="report-section annotation-list"
        aria-label="Image annotations"
      >
        <h3>G. Image annotations</h3>
        <p className="small quiet">
          Manual rectangles only. Use Flag Region in the image toolbar, then
          draw over a slice. Geometry follows image coordinates; no automatic
          localization is performed.
        </p>
        {!report.annotations.length && (
          <p className="small quiet">No manually flagged regions.</p>
        )}
        {report.annotations.map((item, index) => (
          <article
            key={item.id}
            className={`annotation-card ${selectedAnnotationId === item.id ? "selected" : ""}`}
          >
            <div className="section-heading">
              <button
                className="annotation-jump"
                onClick={() => onNavigate(item)}
              >
                Show region {index + 1}
              </button>
              <span className="badge">Manually created</span>
              <button
                className="text-button danger"
                aria-label={`Delete region ${index + 1}`}
                onClick={() => onDeleteAnnotation(item.id)}
              >
                Delete
              </button>
            </div>
            <label>
              Region {index + 1} description
              <textarea
                value={item.description}
                maxLength={10000}
                rows={2}
                onChange={(e) =>
                  updateAnnotation(item.id, { description: e.target.value })
                }
              />
            </label>
            <label>
              Region {index + 1} linked finding
              <select
                aria-label={`Region ${index + 1} linked finding`}
                value={item.findingId ?? ""}
                onChange={(e) => {
                  if (e.target.value)
                    updateAnnotation(item.id, { findingId: e.target.value });
                  else
                    setReport((current) => ({
                      ...current,
                      annotations: current.annotations.map((annotation) => {
                        if (annotation.id !== item.id) return annotation;
                        const { findingId: _removed, ...rest } = annotation;
                        void _removed;
                        return rest;
                      }),
                    }));
                }}
              >
                <option value="">No linked finding</option>
                {report.findings.map((finding, i) => (
                  <option key={finding.id} value={finding.id}>
                    Finding {i + 1}: {finding.structure || finding.category}
                  </option>
                ))}
              </select>
            </label>
            <dl className="annotation-reference">
              <dt>Study</dt>
              <dd>{item.reference.studyInstanceUID}</dd>
              <dt>Series</dt>
              <dd>{item.reference.seriesInstanceUID}</dd>
              <dt>Image (SOP)</dt>
              <dd>{item.reference.sopInstanceUID}</dd>
              <dt>Frame / stack slice</dt>
              <dd>
                {item.reference.frameNumber} / {item.reference.sliceIndex + 1}
              </dd>
            </dl>
          </article>
        ))}
      </section>
      <section className="report-section">
        <h3>H. Report status</h3>
        <label>
          Report status
          <select
            aria-label="Report status"
            value={report.status}
            onChange={(e) =>
              setReport((current) => ({
                ...current,
                status: e.target.value as Report["status"],
              }))
            }
          >
            <option value="draft">Draft</option>
            <option value="reviewed">User-reviewed</option>
          </select>
        </label>
        <p className="small quiet">
          User review is a workflow label, not formal clinical approval or a
          physician signature. Educational research prototype — Not for clinical
          use.
        </p>
      </section>
    </div>
  );
}
