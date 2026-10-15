import {
  FINDING_SOURCES,
  LATERALITIES,
  REVIEW_STATUSES,
  type ClinicalContext,
  type Finding,
  type Report,
} from "../domain";

const MAX_JSON_BYTES = 1_000_000;
const MAX_FINDINGS = 1_000;

function object(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const result = value as Record<string, unknown>;
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`${path}.${key} is required.`);
    }
  }
  for (const key of Object.keys(result)) {
    if (!requiredKeys.includes(key) && !optionalKeys.includes(key)) {
      throw new Error(`${path} contains unsupported field "${key}".`);
    }
  }
  return result;
}

function string(
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = true,
): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be text.`);
  }
  if (value.length > maximum) {
    throw new Error(
      `${path} must be at most ${maximum.toLocaleString("en-US")} characters.`,
    );
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new Error(`${path} must not be empty.`);
  }
  return value;
}

function member<T extends string>(
  value: unknown,
  options: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !options.includes(value as T)) {
    throw new Error(`${path} must be one of: ${options.join(", ")}.`);
  }
  return value as T;
}

function context(value: unknown): ClinicalContext {
  const result = object(value, "clinicalContext", [
    "id",
    "fictional",
    "history",
    "summary",
  ]);
  if (typeof result.fictional !== "boolean") {
    throw new Error("clinicalContext.fictional must be true or false.");
  }
  return {
    id: string(result.id, "clinicalContext.id", 200, false),
    fictional: result.fictional,
    history: string(result.history, "clinicalContext.history", 20_000),
    summary: string(result.summary, "clinicalContext.summary", 10_000),
  };
}

function finding(value: unknown, index: number): Finding {
  const path = `findings[${index}]`;
  const result = object(
    value,
    path,
    ["id", "structure", "observation", "laterality", "reviewStatus", "source"],
    ["note"],
  );
  const parsed: Finding = {
    id: string(result.id, `${path}.id`, 200, false),
    structure: string(result.structure, `${path}.structure`, 200),
    observation: string(result.observation, `${path}.observation`, 5_000),
    laterality: member(result.laterality, LATERALITIES, `${path}.laterality`),
    reviewStatus: member(
      result.reviewStatus,
      REVIEW_STATUSES,
      `${path}.reviewStatus`,
    ),
    source: member(result.source, FINDING_SOURCES, `${path}.source`),
  };
  if (Object.prototype.hasOwnProperty.call(result, "note")) {
    parsed.note = string(result.note, `${path}.note`, 10_000);
  }
  return parsed;
}

function validateReport(value: unknown): Report {
  const result = object(
    value,
    "Report",
    ["schemaVersion", "id", "clinicalContext", "findings"],
    ["studyInstanceUID"],
  );
  if (result.schemaVersion !== 1) {
    throw new Error(
      "Unsupported report schemaVersion. This application supports version 1.",
    );
  }
  if (
    !Array.isArray(result.findings) ||
    result.findings.length > MAX_FINDINGS
  ) {
    throw new Error(
      `findings must be a list containing at most ${MAX_FINDINGS} entries.`,
    );
  }
  const findings = result.findings.map(finding);
  if (new Set(findings.map((entry) => entry.id)).size !== findings.length) {
    throw new Error("Each finding must have a unique id.");
  }
  const parsed: Report = {
    schemaVersion: 1,
    id: string(result.id, "Report.id", 200, false),
    clinicalContext: context(result.clinicalContext),
    findings,
  };
  if (Object.prototype.hasOwnProperty.call(result, "studyInstanceUID")) {
    parsed.studyInstanceUID = string(
      result.studyInstanceUID,
      "Report.studyInstanceUID",
      200,
      false,
    );
  }
  return parsed;
}

/** Validate untrusted JSON before replacing workspace state. */
export function parseReport(json: string): Report {
  if (
    json.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
  ) {
    throw new Error(
      "The report is too large. Import a JSON file smaller than 1 MB.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error(
      "This file is not valid JSON. Choose an exported workspace report.",
    );
  }
  return validateReport(value);
}

/** Export the application format, preserving edits and context provenance. */
export function serializeReport(report: Report): string {
  const json = JSON.stringify(validateReport(report), null, 2);
  if (
    json.length > MAX_JSON_BYTES ||
    new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES
  ) {
    throw new Error(
      "The report is too large to export. Reduce its text or number of findings.",
    );
  }
  return json;
}

export function createFinding(): Finding {
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `finding-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    structure: "",
    observation: "",
    laterality: "unspecified",
    reviewStatus: "draft",
    source: "clinician entered",
  };
}
