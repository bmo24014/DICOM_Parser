/** Application JSON types. This format is not DICOM Structured Reporting. */
export interface DicomInstance {
  id: string;
  /** The original local file, retained without modifying its bytes. */
  file: File;
  instanceNumber: number;
  frameCount: number;
}

export interface Series {
  id: string;
  description: string;
  modality: string;
  instances: DicomInstance[];
}

export interface Study {
  id: string;
  description: string;
  series: Series[];
}

export interface ClinicalContext {
  id: string;
  fictional: boolean;
  history: string;
  /** Manually authored context, separate from image-derived findings. */
  summary: string;
}

export const LATERALITIES = [
  "left",
  "right",
  "bilateral",
  "unspecified",
] as const;
export const REVIEW_STATUSES = ["draft", "reviewed"] as const;
export const FINDING_SOURCES = [
  "clinician entered",
  "dataset label",
  "simulated",
] as const;

export interface Finding {
  id: string;
  structure: string;
  observation: string;
  laterality: (typeof LATERALITIES)[number];
  note?: string;
  reviewStatus: (typeof REVIEW_STATUSES)[number];
  source: (typeof FINDING_SOURCES)[number];
}

export interface Report {
  schemaVersion: 1;
  id: string;
  studyInstanceUID?: string;
  clinicalContext: ClinicalContext;
  findings: Finding[];
}
