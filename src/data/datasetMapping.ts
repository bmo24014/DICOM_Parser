import type { Finding } from "../domain";
import { createFinding } from "./reports";

/** A future adapter must supply labels explicitly associated with a study. */
export interface DatasetStudyLabels {
  datasetName: string;
  studyInstanceUID: string;
  labels: readonly string[];
}

/**
 * Study labels are text annotations, never lesion coordinates or overlays.
 * No SCOPE-MRI files, schema, or access are assumed by this adapter boundary.
 */
export function mapStudyLabelsToFindings(input: DatasetStudyLabels): Finding[] {
  if (!input.datasetName.trim() || !input.studyInstanceUID.trim()) {
    throw new Error(
      "Dataset labels require a dataset name and an explicit study identifier.",
    );
  }
  if (
    input.labels.some((label) => typeof label !== "string" || !label.trim())
  ) {
    throw new Error("Each dataset label must contain text.");
  }
  return input.labels.map((label) => ({
    ...createFinding(),
    structure: "Study-level dataset annotation",
    observation: label,
    source: "dataset label",
    note: `${input.datasetName}: study-level label; no image localization or clinician verification is implied.`,
  }));
}
