import { describe, expect, it } from "vitest";
import { demoReport } from "./demo";
import { mapStudyLabelsToFindings } from "./datasetMapping";
import { createFinding, parseReport, serializeReport } from "./reports";
import type { Report } from "../domain";

function freshReport(): Report {
  return structuredClone(demoReport);
}

describe("workspace JSON reports", () => {
  it("round-trips all edited fields and additions without changing their values", () => {
    const report = freshReport();
    report.studyInstanceUID = "1.2.840.10008.123";
    report.findings[0] = {
      id: "edited-finding",
      structure: "Subscapularis tendon",
      observation: 'User-authored observation with "quotes" and <plain text>.',
      laterality: "left",
      note: "Line one\nLine two — preserved Unicode.",
      reviewStatus: "reviewed",
      source: "clinician entered",
    };
    report.findings.push({
      ...createFinding(),
      observation: "An additional draft.",
    });
    report.clinicalContext.summary = "Edited manually authored context.";

    expect(parseReport(serializeReport(report))).toEqual(report);
  });

  it("preserves a deleted entry and an absent optional note", () => {
    const report = freshReport();
    report.findings.splice(0, 1);
    const imported = parseReport(serializeReport(report));
    expect(imported.findings).toEqual(report.findings);
    expect(imported.findings[0]).not.toHaveProperty("note");
  });

  it("preserves non-fictional context instead of relabeling imported information as demo data", () => {
    const report = freshReport();
    report.clinicalContext.fictional = false;
    expect(parseReport(serializeReport(report)).clinicalContext.fictional).toBe(
      false,
    );
  });

  it("rejects invalid JSON and non-object roots", () => {
    expect(() => parseReport("{")).toThrow("not valid JSON");
    for (const input of ["null", "[]", '"report"']) {
      expect(() => parseReport(input)).toThrow("must be an object");
    }
  });

  it("rejects unsupported schema versions and missing required fields", () => {
    expect(() =>
      parseReport(JSON.stringify({ ...demoReport, schemaVersion: 2 })),
    ).toThrow("Unsupported report schemaVersion");
    const missingContext: Record<string, unknown> = { ...demoReport };
    delete missingContext.clinicalContext;
    expect(() => parseReport(JSON.stringify(missingContext))).toThrow(
      "clinicalContext is required",
    );
  });

  it.each([
    ["laterality", "both"],
    ["reviewStatus", "approved"],
    ["source", "AI generated"],
    ["observation", 42],
    ["note", null],
    ["id", ""],
  ])("rejects an invalid %s", (key, value) => {
    const report = freshReport();
    Object.assign(report.findings[0], { [key]: value });
    expect(() => parseReport(JSON.stringify(report))).toThrow();
  });

  it("requires a boolean fictional flag and rejects unknown fields without silently losing data", () => {
    const report = freshReport();
    Object.assign(report.clinicalContext, { fictional: "true" });
    expect(() => parseReport(JSON.stringify(report))).toThrow(
      "must be true or false",
    );
    expect(() =>
      parseReport(JSON.stringify({ ...demoReport, measurements: [] })),
    ).toThrow("unsupported field");
  });

  it("rejects duplicate finding ids and oversized fields/files", () => {
    const report = freshReport();
    report.findings[1].id = report.findings[0].id;
    expect(() => parseReport(JSON.stringify(report))).toThrow("unique id");
    report.findings.pop();
    report.findings[0].structure = "x".repeat(201);
    expect(() => serializeReport(report)).toThrow("at most 200");
    expect(() => parseReport(" ".repeat(1_000_001))).toThrow("too large");
    expect(() =>
      parseReport(
        JSON.stringify({
          ...demoReport,
          findings: Array(1_001).fill(demoReport.findings[0]),
        }),
      ),
    ).toThrow("at most 1000");
  });

  it("creates distinct, empty draft findings with an explicit manual source", () => {
    const first = createFinding();
    const second = createFinding();
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      structure: "",
      observation: "",
      laterality: "unspecified",
      reviewStatus: "draft",
      source: "clinician entered",
    });
    expect(
      parseReport(serializeReport({ ...demoReport, findings: [first] }))
        .findings,
    ).toEqual([first]);
  });

  it("applies the import and export limit to UTF-8 bytes, including Unicode text", () => {
    const report = freshReport();
    report.findings = Array.from({ length: 40 }, (_, index) => ({
      ...createFinding(),
      id: `unicode-${index}`,
      note: "肩".repeat(9_000),
    }));
    const compactJson = JSON.stringify(report);
    expect(compactJson.length).toBeLessThan(1_000_000);
    expect(() => parseReport(compactJson)).toThrow("too large");
    expect(() => serializeReport(report)).toThrow("too large");
  });
});

describe("study-level dataset adapter boundary", () => {
  it("maps supplied labels as unreviewed text without inventing laterality or coordinates", () => {
    const findings = mapStudyLabelsToFindings({
      datasetName: "Example research dataset",
      studyInstanceUID: "1.2.3",
      labels: ["An explicitly supplied study label"],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      observation: "An explicitly supplied study label",
      source: "dataset label",
      laterality: "unspecified",
      reviewStatus: "draft",
    });
    expect(findings[0]).not.toHaveProperty("coordinates");
    expect(findings[0].note).toContain("no image localization");
  });

  it("requires an explicit study association and nonempty labels", () => {
    expect(() =>
      mapStudyLabelsToFindings({
        datasetName: "Example",
        studyInstanceUID: "",
        labels: ["A"],
      }),
    ).toThrow("explicit study identifier");
    expect(() =>
      mapStudyLabelsToFindings({
        datasetName: "Example",
        studyInstanceUID: "1.2.3",
        labels: [" "],
      }),
    ).toThrow("must contain text");
  });
});
