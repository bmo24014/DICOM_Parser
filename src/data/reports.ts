import {
  CLINICAL_CONTEXT_PROVENANCES,
  FINDING_CATEGORIES,
  FINDING_SOURCES,
  LATERALITIES,
  REVIEW_STATUSES,
  type ClinicalContext,
  type Finding,
  type FindingCategory,
  type ImageReference,
  type ManualAnnotation,
  type Report,
} from "../domain";

const MAX_JSON_BYTES = 1_000_000;
const MAX_ENTRIES = 1_000;

function object(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path} must be an object.`);
  const result = value as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(result, key))
      throw new Error(`${path}.${key} is required.`);
  }
  for (const key of Object.keys(result)) {
    if (!requiredKeys.includes(key) && !optionalKeys.includes(key))
      throw new Error(`${path} contains unsupported field "${key}".`);
  }
  return result;
}

function text(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = true,
): string {
  if (typeof value !== "string") throw new Error(`${path} must be text.`);
  if (value.length > maximum)
    throw new Error(
      `${path} must be at most ${maximum.toLocaleString("en-US")} characters.`,
    );
  if (!allowEmpty && value.trim().length === 0)
    throw new Error(`${path} must not be empty.`);
  return value;
}

function member<T extends string>(
  value: unknown,
  options: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T))
    throw new Error(`${path} must be one of: ${options.join(", ")}.`);
  return value as T;
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES)
    throw new Error(`${path} must be a list containing at most 1000 entries.`);
  return value;
}

function context(value: unknown, legacy: boolean): ClinicalContext {
  const result = object(
    value,
    "clinicalContext",
    legacy
      ? ["id", "fictional", "history", "summary"]
      : [
          "id",
          "fictional",
          "history",
          "summary",
          "caseIdentifier",
          "provenance",
          "indication",
          "notes",
        ],
  );
  if (typeof result.fictional !== "boolean")
    throw new Error("clinicalContext.fictional must be true or false.");
  return {
    id: text(result.id, "clinicalContext.id", 200, false),
    fictional: result.fictional,
    history: text(result.history, "clinicalContext.history", 20_000),
    summary: text(result.summary, "clinicalContext.summary", 10_000),
    caseIdentifier: legacy
      ? ""
      : text(result.caseIdentifier, "clinicalContext.caseIdentifier", 200),
    provenance: legacy
      ? "imported"
      : member(
          result.provenance,
          CLINICAL_CONTEXT_PROVENANCES,
          "clinicalContext.provenance",
        ),
    indication: legacy
      ? ""
      : text(result.indication, "clinicalContext.indication", 10_000),
    notes: legacy ? "" : text(result.notes, "clinicalContext.notes", 20_000),
  };
}

function finding(value: unknown, index: number, legacy: boolean): Finding {
  const path = `findings[${index}]`;
  const keys = [
    "id",
    "structure",
    "observation",
    "laterality",
    "reviewStatus",
    "source",
  ];
  const result = object(value, path, legacy ? keys : [...keys, "category"], [
    "note",
  ]);
  const parsed: Finding = {
    id: text(result.id, `${path}.id`, 200, false),
    category: legacy
      ? "Other soft tissues"
      : member(result.category, FINDING_CATEGORIES, `${path}.category`),
    structure: text(result.structure, `${path}.structure`, 200),
    observation: text(result.observation, `${path}.observation`, 5_000),
    laterality: member(result.laterality, LATERALITIES, `${path}.laterality`),
    reviewStatus: member(
      result.reviewStatus,
      REVIEW_STATUSES,
      `${path}.reviewStatus`,
    ),
    source: member(result.source, FINDING_SOURCES, `${path}.source`),
  };
  if (Object.prototype.hasOwnProperty.call(result, "note"))
    parsed.note = text(result.note, `${path}.note`, 10_000);
  return parsed;
}

function integer(value: unknown, path: string, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > 10_000_000
  )
    throw new Error(
      `${path} must be an integer between ${minimum} and 10000000.`,
    );
  return value;
}

function vector(value: unknown, path: string): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (number) =>
        typeof number !== "number" ||
        !Number.isFinite(number) ||
        Math.abs(number) > 1_000_000_000,
    )
  )
    throw new Error(`${path} must contain three finite world coordinates.`);
  return [value[0], value[1], value[2]];
}

/** Scale-independent direction check: imported orientations need not be unit length. */
function independentDirections(
  a: readonly number[],
  b: readonly number[],
): boolean {
  const lengthA = Math.hypot(...a);
  const lengthB = Math.hypot(...b);
  if (lengthA === 0 || lengthB === 0) return false;
  const [ax, ay, az] = a.map((value) => value / lengthA);
  const [bx, by, bz] = b.map((value) => value / lengthB);
  const crossLength = Math.hypot(
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  );
  // This only excludes directions indistinguishable from parallel at floating-point precision.
  return crossLength > Number.EPSILON * 32;
}

function validateAnnotationGeometry(
  annotation: ManualAnnotation,
  path: string,
) {
  if (!independentDirections(annotation.viewPlaneNormal, annotation.viewUp)) {
    throw new Error(
      `${path}.viewPlaneNormal and viewUp must be nonzero, nonparallel direction vectors.`,
    );
  }
  const points = annotation.points;
  for (let first = 0; first < points.length; first++) {
    for (let second = first + 1; second < points.length; second++) {
      if (
        points[first].every(
          (coordinate, axis) => coordinate === points[second][axis],
        )
      ) {
        throw new Error(
          `${path}.points must contain distinct rectangle corners with nonzero area.`,
        );
      }
    }
  }
  // Cornerstone rectangle handles are TL, TR, BL, BR. The first two edges
  // must span an area; checking only a diagonal would accept collapsed lines.
  const horizontal = points[1].map(
    (coordinate, axis) => coordinate - points[0][axis],
  );
  const vertical = points[2].map(
    (coordinate, axis) => coordinate - points[0][axis],
  );
  if (!independentDirections(horizontal, vertical)) {
    throw new Error(
      `${path}.points must define a rectangle with nonzero area.`,
    );
  }
}

function annotation(value: unknown, index: number): ManualAnnotation {
  const path = `annotations[${index}]`;
  const result = object(
    value,
    path,
    [
      "id",
      "source",
      "shape",
      "description",
      "reference",
      "points",
      "viewPlaneNormal",
      "viewUp",
    ],
    ["findingId"],
  );
  const ref = object(result.reference, `${path}.reference`, [
    "studyInstanceUID",
    "seriesInstanceUID",
    "sopInstanceUID",
    "frameNumber",
    "sliceIndex",
  ]);
  const reference: ImageReference = {
    studyInstanceUID: text(
      ref.studyInstanceUID,
      `${path}.reference.studyInstanceUID`,
      200,
      false,
    ),
    seriesInstanceUID: text(
      ref.seriesInstanceUID,
      `${path}.reference.seriesInstanceUID`,
      200,
      false,
    ),
    sopInstanceUID: text(
      ref.sopInstanceUID,
      `${path}.reference.sopInstanceUID`,
      200,
      false,
    ),
    frameNumber: integer(ref.frameNumber, `${path}.reference.frameNumber`, 1),
    sliceIndex: integer(ref.sliceIndex, `${path}.reference.sliceIndex`, 0),
  };
  if (!Array.isArray(result.points) || result.points.length !== 4)
    throw new Error(`${path}.points must contain four rectangle corners.`);
  const parsed: ManualAnnotation = {
    id: text(result.id, `${path}.id`, 200, false),
    source: member(result.source, ["manual"], `${path}.source`),
    shape: member(result.shape, ["rectangle"], `${path}.shape`),
    description: text(result.description, `${path}.description`, 10_000),
    reference,
    points: result.points.map((point, pointIndex) =>
      vector(point, `${path}.points[${pointIndex}]`),
    ),
    viewPlaneNormal: vector(result.viewPlaneNormal, `${path}.viewPlaneNormal`),
    viewUp: vector(result.viewUp, `${path}.viewUp`),
  };
  if (Object.prototype.hasOwnProperty.call(result, "findingId"))
    parsed.findingId = text(result.findingId, `${path}.findingId`, 200, false);
  validateAnnotationGeometry(parsed, path);
  return parsed;
}

function validateReport(value: unknown, acceptLegacy: boolean): Report {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Report must be an object.");
  const version = (value as Record<string, unknown>).schemaVersion;
  if (version !== 2 && !(acceptLegacy && version === 1))
    throw new Error(
      "Unsupported report schemaVersion. This application imports versions 1 and 2 and saves version 2.",
    );
  const legacy = version === 1;
  const keys = ["schemaVersion", "id", "clinicalContext", "findings"];
  const result = object(
    value,
    "Report",
    legacy
      ? keys
      : [
          ...keys,
          "examination",
          "technique",
          "comparison",
          "impression",
          "status",
          "annotations",
        ],
    ["studyInstanceUID"],
  );
  const findings = list(result.findings, "findings").map((entry, index) =>
    finding(entry, index, legacy),
  );
  if (new Set(findings.map((entry) => entry.id)).size !== findings.length)
    throw new Error("Each finding must have a unique id.");
  const parsed: Report = {
    schemaVersion: 2,
    id: text(result.id, "Report.id", 200, false),
    clinicalContext: context(result.clinicalContext, legacy),
    examination: { type: "", laterality: "unspecified", date: "" },
    technique: { acquisition: "", contrast: "" },
    comparison: "",
    findings,
    impression: [],
    status: "draft",
    annotations: [],
  };
  if (Object.prototype.hasOwnProperty.call(result, "studyInstanceUID"))
    parsed.studyInstanceUID = text(
      result.studyInstanceUID,
      "Report.studyInstanceUID",
      200,
      false,
    );
  if (!legacy) {
    const exam = object(result.examination, "examination", [
      "type",
      "laterality",
      "date",
    ]);
    const date = text(exam.date, "examination.date", 10);
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    )
      throw new Error(
        "examination.date must be blank or a valid YYYY-MM-DD date.",
      );
    parsed.examination = {
      type: text(exam.type, "examination.type", 500),
      laterality: member(
        exam.laterality,
        LATERALITIES,
        "examination.laterality",
      ),
      date,
    };
    const technique = object(result.technique, "technique", [
      "acquisition",
      "contrast",
    ]);
    parsed.technique = {
      acquisition: text(technique.acquisition, "technique.acquisition", 20_000),
      contrast: text(technique.contrast, "technique.contrast", 10_000),
    };
    parsed.comparison = text(result.comparison, "comparison", 20_000);
    parsed.impression = list(result.impression, "impression").map(
      (entry, index) => text(entry, `impression[${index}]`, 10_000),
    );
    parsed.status = member(result.status, REVIEW_STATUSES, "status");
    parsed.annotations = list(result.annotations, "annotations").map(
      annotation,
    );
    if (
      new Set(parsed.annotations.map((entry) => entry.id)).size !==
      parsed.annotations.length
    )
      throw new Error("Each annotation must have a unique id.");
    const findingIds = new Set(findings.map((entry) => entry.id));
    for (const entry of parsed.annotations) {
      if (entry.findingId && !findingIds.has(entry.findingId))
        throw new Error(
          `Annotation "${entry.id}" references a finding that is not present in the report.`,
        );
    }
  }
  return parsed;
}

/** Validate untrusted JSON before replacing workspace state; migrate original v1 drafts without losing text. */
export function parseReport(json: string): Report {
  if (
    json.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
  )
    throw new Error(
      "The report is too large. Import a JSON file smaller than 1 MB.",
    );
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(
      "This file is not valid JSON. Choose an exported workspace report.",
    );
  }
  return validateReport(value, true);
}

/** Export only the complete version 2 application format, never DICOM bytes or DICOM SR. */
export function serializeReport(report: Report): string {
  const json = JSON.stringify(validateReport(report, false), null, 2);
  if (
    json.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
  )
    throw new Error(
      "The report is too large to export. Reduce its text or number of findings.",
    );
  return json;
}

export function createFinding(
  category: FindingCategory = FINDING_CATEGORIES[0],
): Finding {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `finding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    category,
    structure: "",
    observation: "",
    laterality: "unspecified",
    reviewStatus: "draft",
    source: "clinician entered",
  };
}
