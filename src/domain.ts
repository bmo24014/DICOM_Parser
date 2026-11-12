/** Application JSON types. This format is not DICOM Structured Reporting. */
export interface DicomInstance {
  id: string;
  /** The original local file, retained without modifying its bytes. */
  file: File;
  instanceNumber: number;
  frameCount: number;
  sopInstanceUID?: string;
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

export const CLINICAL_CONTEXT_PROVENANCES = [
  "simulated",
  "imported",
  "manual",
] as const;
export type ClinicalContextProvenance =
  (typeof CLINICAL_CONTEXT_PROVENANCES)[number];
export interface ClinicalContext {
  id: string;
  fictional: boolean;
  caseIdentifier: string;
  provenance: ClinicalContextProvenance;
  history: string;
  indication: string;
  /** Authored text, separate from image-derived findings. */
  summary: string;
  notes: string;
}

export const LATERALITIES = [
  "left",
  "right",
  "bilateral",
  "unspecified",
] as const;
export type Laterality = (typeof LATERALITIES)[number];
export const REVIEW_STATUSES = ["draft", "reviewed"] as const;
export const FINDING_SOURCES = [
  "clinician entered",
  "dataset label",
  "simulated",
] as const;
export const FINDING_CATEGORIES = [
  "Rotator cuff",
  "Long head of biceps tendon",
  "Labrum",
  "Acromioclavicular joint",
  "Glenohumeral joint and cartilage",
  "Bones and bone marrow",
  "Other soft tissues",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface Finding {
  id: string;
  category: FindingCategory;
  structure: string;
  observation: string;
  laterality: Laterality;
  note?: string;
  reviewStatus: (typeof REVIEW_STATUSES)[number];
  source: (typeof FINDING_SOURCES)[number];
}

export interface ImageReference {
  studyInstanceUID: string;
  seriesInstanceUID: string;
  sopInstanceUID: string;
  /** DICOM frame number, starting at one within its SOP instance. */
  frameNumber: number;
  /** Displayed zero-based stack position; SOP/frame identity is authoritative. */
  sliceIndex: number;
}

/** Manually placed rectangle, retained in Cornerstone world coordinates. */
export interface ManualAnnotation {
  id: string;
  source: "manual";
  shape: "rectangle";
  description: string;
  findingId?: string;
  reference: ImageReference;
  points: [number, number, number][];
  viewPlaneNormal: [number, number, number];
  viewUp: [number, number, number];
}

export interface Report {
  schemaVersion: 2;
  id: string;
  /** Set only after explicit user association; importing files does not set this. */
  studyInstanceUID?: string;
  clinicalContext: ClinicalContext;
  examination: { type: string; laterality: Laterality; date: string };
  technique: { acquisition: string; contrast: string };
  comparison: string;
  findings: Finding[];
  impression: string[];
  status: (typeof REVIEW_STATUSES)[number];
  annotations: ManualAnnotation[];
}
