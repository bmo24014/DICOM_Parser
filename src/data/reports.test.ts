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
      category: "Rotator cuff",
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
      parseReport(JSON.stringify({ ...demoReport, schemaVersion: 99 })),
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

describe("structured report model and legacy migration", () => {
  function legacyDraft() {
    return {
      schemaVersion: 1,
      id: "legacy-draft",
      studyInstanceUID: "1.2.3.4",
      clinicalContext: {
        id: "legacy-context",
        fictional: false,
        history: "Original history\nwith second line.",
        summary: "Original summary — unchanged.",
      },
      findings: [
        {
          id: "legacy-one",
          structure: "Tendon",
          observation: "Previously entered text",
          laterality: "left",
          reviewStatus: "reviewed",
          source: "clinician entered",
          note: "Original note",
        },
        {
          id: "legacy-two",
          structure: "Joint",
          observation: "",
          laterality: "unspecified",
          reviewStatus: "draft",
          source: "simulated",
        },
      ],
    };
  }

  function annotatedDraft(): Report {
    const report = freshReport();
    report.clinicalContext = {
      ...report.clinicalContext,
      fictional: false,
      caseIdentifier: "Deidentified case X",
      provenance: "manual",
      indication: "Authored indication",
      history: "Edited history",
      summary: "Edited summary",
      notes: "Additional symptoms",
    };
    report.examination = {
      type: "Shoulder MRI",
      laterality: "left",
      date: "2026-02-28",
    };
    report.technique = {
      acquisition: "Manually entered acquisition",
      contrast: "Not supplied",
    };
    report.comparison = "Prior study reference entered manually";
    report.impression = ["First user-authored statement.", "Second statement."];
    report.status = "reviewed";
    report.annotations = [
      {
        id: "manual-region-01",
        source: "manual",
        shape: "rectangle",
        description: "User flagged region",
        findingId: report.findings[0].id,
        reference: {
          studyInstanceUID: "1.2.3",
          seriesInstanceUID: "1.2.3.1",
          sopInstanceUID: "1.2.3.1.1",
          frameNumber: 1,
          sliceIndex: 0,
        },
        points: [
          [10, 20, 0],
          [30, 20, 0],
          [10, 40, 0],
          [30, 40, 0],
        ],
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      },
    ];
    return report;
  }

  it("migrates original exports while preserving every old context and finding field", () => {
    const legacy = legacyDraft();
    const migrated = parseReport(JSON.stringify(legacy));
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.id).toBe(legacy.id);
    expect(migrated.studyInstanceUID).toBe(legacy.studyInstanceUID);
    expect(migrated.clinicalContext).toMatchObject(legacy.clinicalContext);
    expect(migrated.clinicalContext).toMatchObject({
      provenance: "imported",
      caseIdentifier: "",
      indication: "",
      notes: "",
    });
    for (const [index, finding] of migrated.findings.entries()) {
      const { category, ...original } = finding;
      expect(original).toEqual(legacy.findings[index]);
      expect(category).toBe("Other soft tissues");
    }
    expect(migrated.examination).toEqual({
      type: "",
      laterality: "unspecified",
      date: "",
    });
    expect(migrated.impression).toEqual([]);
    expect(migrated.annotations).toEqual([]);
    expect(migrated.status).toBe("draft");
    expect(JSON.parse(serializeReport(migrated)).schemaVersion).toBe(3);
  });

  it("preserves fictional legacy provenance while marking the file imported", () => {
    const legacy = legacyDraft();
    legacy.clinicalContext.fictional = true;
    expect(parseReport(JSON.stringify(legacy)).clinicalContext).toMatchObject({
      fictional: true,
      provenance: "imported",
    });
  });

  it("rejects malformed legacy drafts instead of dropping their fields during migration", () => {
    const legacy = legacyDraft();
    expect(() =>
      parseReport(JSON.stringify({ ...legacy, unrecognized: "keep me" })),
    ).toThrow("unsupported field");
    legacy.findings[0].laterality = "invalid";
    expect(() => parseReport(JSON.stringify(legacy))).toThrow("laterality");
  });

  it("round-trips all structured sections, world coordinates, provenance, and linked findings", () => {
    const report = annotatedDraft();
    expect(parseReport(serializeReport(report))).toEqual(report);
    expect(serializeReport(report)).not.toContain("pixelData");
  });

  it.each([
    ["points", [[1, 2, 3]]],
    [
      "points",
      [
        [1, 2, 3],
        [1, 2, 3],
        [1, 2, 3],
        [null, 2, 3],
      ],
    ],
    ["viewPlaneNormal", [0, 1]],
    ["source", "AI generated"],
    ["shape", "ellipse"],
    ["findingId", "missing-finding"],
  ])("rejects invalid annotation %s", (key, value) => {
    const report = annotatedDraft();
    Object.assign(report.annotations[0], { [key]: value });
    expect(() => parseReport(JSON.stringify(report))).toThrow();
  });

  it.each([
    ["viewPlaneNormal", [0, 0, 0]],
    ["viewUp", [0, 0, 0]],
    ["viewUp", [0, 0, 2]],
    ["viewUp", [0, 0, -3]],
  ])("rejects a zero or parallel annotation orientation: %s", (key, value) => {
    const report = annotatedDraft();
    Object.assign(report.annotations[0], { [key]: value });
    expect(() => parseReport(JSON.stringify(report))).toThrow(
      "nonzero, nonparallel",
    );
  });

  it("rejects duplicate rectangle corners, including a duplicated fourth handle", () => {
    for (const duplicateIndex of [1, 2, 3]) {
      const report = annotatedDraft();
      report.annotations[0].points[duplicateIndex] = [
        ...report.annotations[0].points[0],
      ];
      expect(() => serializeReport(report)).toThrow(
        "distinct rectangle corners",
      );
    }
  });

  it("rejects a collapsed rectangle whose distinct corners are collinear", () => {
    const report = annotatedDraft();
    report.annotations[0].points = [
      [0, 0, 0],
      [1, 2, 3],
      [2, 4, 6],
      [3, 6, 9],
    ];
    expect(() => parseReport(JSON.stringify(report))).toThrow("nonzero area");
  });

  it("accepts non-unit orientation vectors and small, nondegenerate rectangles without changing them", () => {
    const report = annotatedDraft();
    report.annotations[0].viewPlaneNormal = [0, 0, 5];
    report.annotations[0].viewUp = [0, -0.25, 0];
    report.annotations[0].points = [
      [0, 0, 0],
      [0.00001, 0, 0],
      [0, 0.00001, 0],
      [0.00001, 0.00001, 0],
    ];
    expect(parseReport(serializeReport(report))).toEqual(report);
  });

  it.each([
    ["frameNumber", 0],
    ["frameNumber", 1.5],
    ["sliceIndex", -1],
    ["sliceIndex", 0.1],
    ["sopInstanceUID", ""],
  ])("rejects invalid image reference %s", (key, value) => {
    const report = annotatedDraft();
    Object.assign(report.annotations[0].reference, { [key]: value });
    expect(() => parseReport(JSON.stringify(report))).toThrow();
  });

  it("rejects duplicate annotations, unknown categories, unknown provenance, and invalid dates", () => {
    const report = annotatedDraft();
    report.annotations.push(structuredClone(report.annotations[0]));
    expect(() => serializeReport(report)).toThrow("unique id");
    report.annotations.pop();
    Object.assign(report.findings[0], { category: "Unknown anatomy" });
    expect(() => serializeReport(report)).toThrow("category");
    report.findings[0].category = "Rotator cuff";
    Object.assign(report.clinicalContext, { provenance: "inferred" });
    expect(() => serializeReport(report)).toThrow("provenance");
    report.clinicalContext.provenance = "manual";
    report.examination.date = "2026-02-30";
    expect(() => serializeReport(report)).toThrow("valid YYYY-MM-DD");
  });

  it("rejects unknown v2 fields and truncated required sections", () => {
    expect(() =>
      parseReport(JSON.stringify({ ...demoReport, pixels: [1, 2, 3] })),
    ).toThrow("unsupported field");
    const missing: Record<string, unknown> = { ...demoReport };
    delete missing.examination;
    expect(() => parseReport(JSON.stringify(missing))).toThrow(
      "examination is required",
    );
  });

  it("does not silently migrate or save a legacy runtime value without validation", () => {
    expect(() => serializeReport(legacyDraft() as unknown as Report)).toThrow(
      "Unsupported report schemaVersion",
    );
  });
});

describe("version 3 summary provenance", () => {
  function acceptedReport(): Report {
    const report = freshReport();
    report.clinicalContext.summary = "A reviewed AI-assisted text summary.";
    report.clinicalContext.summaryProvenance = {
      origin: "ai-assisted",
      model: "qwen2.5:1.5b",
      generatedAt: "2026-11-12T14:30:00.000Z",
      acceptance: "user-accepted",
      sourceFingerprint: "a".repeat(64),
    };
    return report;
  }

  it("preserves accepted and edited AI-assisted metadata in JSON without relabeling the source history", () => {
    const report = acceptedReport();
    expect(parseReport(serializeReport(report))).toEqual(report);
    report.clinicalContext.summaryProvenance.origin = "edited-ai-assisted";
    expect(parseReport(serializeReport(report))).toEqual(report);
    expect(report.clinicalContext.provenance).toBe("simulated");
    expect(report.schemaVersion).toBe(3);
  });

  it("migrates complete version 2 drafts without inventing AI provenance or losing sections", () => {
    const report = freshReport();
    report.studyInstanceUID = "1.2.3";
    report.clinicalContext.summary =
      "Previously saved summary; authorship not recorded.";
    report.technique.acquisition = "Retained acquisition text";
    report.impression = ["Retained impression"];
    report.status = "reviewed";
    report.annotations = [
      {
        id: "retained-v2-region",
        source: "manual",
        shape: "rectangle",
        description: "Existing v2 region",
        findingId: report.findings[0].id,
        reference: {
          studyInstanceUID: "1.2.3",
          seriesInstanceUID: "1.2.3.4",
          sopInstanceUID: "1.2.3.4.5",
          frameNumber: 2,
          sliceIndex: 5,
        },
        points: [
          [0, 0, 0],
          [10, 0, 0],
          [0, 20, 0],
          [10, 20, 0],
        ],
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      },
    ];
    const { summaryProvenance: removed, ...oldContext } =
      report.clinicalContext;
    void removed;
    const v2 = { ...report, schemaVersion: 2, clinicalContext: oldContext };
    const migrated = parseReport(JSON.stringify(v2));
    expect(migrated).toEqual({
      ...report,
      clinicalContext: {
        ...oldContext,
        summaryProvenance: { origin: "legacy-unknown" },
      },
    });
    expect(JSON.parse(serializeReport(migrated)).schemaVersion).toBe(3);
    expect(() => serializeReport(v2 as unknown as Report)).toThrow(
      "Unsupported report schemaVersion",
    );
  });

  it("preserves manual and legacy-unknown labels without generating metadata", () => {
    for (const origin of ["manual", "legacy-unknown"] as const) {
      const report = freshReport();
      report.clinicalContext.summaryProvenance = { origin };
      expect(
        parseReport(serializeReport(report)).clinicalContext.summaryProvenance,
      ).toEqual({ origin });
    }
  });

  it.each([
    ["origin", "AI generated"],
    ["model", ""],
    ["model", 42],
    ["generatedAt", "not a date"],
    ["generatedAt", "2026-02-30T12:00:00Z"],
    ["generatedAt", "2026-11-12"],
    ["generatedAt", "2026-11-12T12:00:00"],
    ["acceptance", "clinician-approved"],
    ["acceptance", "pending"],
    ["sourceFingerprint", "abcd"],
    ["sourceFingerprint", "A".repeat(64)],
  ])("rejects invalid summary provenance %s", (key, value) => {
    const report = acceptedReport();
    Object.assign(report.clinicalContext.summaryProvenance, { [key]: value });
    expect(() => parseReport(JSON.stringify(report))).toThrow();
  });

  it("rejects incomplete provenance, extraneous metadata on manual text, and unsaved proposals", () => {
    const report = acceptedReport();
    const json = JSON.parse(JSON.stringify(report));
    delete json.clinicalContext.summaryProvenance.acceptance;
    expect(() => parseReport(JSON.stringify(json))).toThrow(
      "acceptance is required",
    );
    Object.assign(report.clinicalContext.summaryProvenance, {
      origin: "manual",
    });
    expect(() => serializeReport(report)).toThrow("unsupported field");
    expect(() =>
      parseReport(
        JSON.stringify({
          ...freshReport(),
          proposedSummary: "Never save this draft automatically",
        }),
      ),
    ).toThrow("unsupported field");
    const missing = JSON.parse(JSON.stringify(freshReport()));
    delete missing.clinicalContext.summaryProvenance;
    expect(() => parseReport(JSON.stringify(missing))).toThrow(
      "summaryProvenance is required",
    );
  });
});
