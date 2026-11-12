import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { demoReport } from "./demo";
import {
  generateReportPdf,
  PDF_DISCLAIMER,
  reportSections,
  wrapPdfText,
} from "./pdf";

const fontBytes = await readFile(
  new URL("../assets/DejaVuSans.ttf", import.meta.url),
);

describe("PDF report presentation", () => {
  it("uses every current field and annotation reference without deriving clinical details", () => {
    const report = structuredClone(demoReport);
    report.clinicalContext = {
      ...report.clinicalContext,
      caseIdentifier: "Fictional-42",
      indication: "Edited indication",
      history: "Edited history",
      summary: "Edited summary",
      notes: "Edited symptoms",
      provenance: "manual",
    };
    report.examination = {
      type: "Edited exam",
      date: "2026-11-12",
      laterality: "left",
    };
    report.technique = {
      acquisition: "Edited technique",
      contrast: "Edited contrast",
    };
    report.comparison = "Edited comparison";
    report.impression = ["Edited first statement", "Edited second statement"];
    report.findings[0].observation = "Edited observation";
    report.status = "reviewed";
    report.studyInstanceUID = "1.2.3";
    report.annotations = [
      {
        id: "manual-region",
        source: "manual",
        shape: "rectangle",
        description: "Edited region description",
        findingId: report.findings[0].id,
        reference: {
          studyInstanceUID: "1.2.3",
          seriesInstanceUID: "1.2.3.4",
          sopInstanceUID: "1.2.3.4.5",
          frameNumber: 2,
          sliceIndex: 4,
        },
        points: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ],
        viewPlaneNormal: [0, 0, 1],
        viewUp: [0, -1, 0],
      },
    ];
    const sections = reportSections(report);
    expect(sections).toHaveLength(8);
    const text = sections
      .flatMap((section) => [
        section.heading,
        ...section.fields.flatMap((field) => [field.label, field.value]),
      ])
      .join("\n");
    for (const value of [
      "Fictional-42",
      "Edited indication",
      "Edited history",
      "Edited summary",
      "Edited symptoms",
      "Edited exam",
      "2026-11-12",
      "Edited technique",
      "Edited contrast",
      "Edited comparison",
      ...report.impression,
      "Edited observation",
      "Edited region description",
      "1.2.3.4.5",
      "Frame 2; stack slice 5",
      "User-reviewed",
    ]) {
      expect(text).toContain(value);
    }
    expect(text).toContain("not formal clinical approval");
    expect(text).toContain("Not provided.");
  });

  it("wraps long words, spaces, unicode and lines without losing characters", () => {
    const original = "alpha beta  gamma" + "LONG".repeat(25) + "é Ω";
    const lines = wrapPdfText(original, 12, (value) => [...value].length);
    expect(lines.join("")).toBe(original);
    expect(lines.every((line) => [...line].length <= 12)).toBe(true);
    expect(wrapPdfText("one\n\ntwo", 12, (value) => value.length)).toEqual([
      "one",
      "",
      "two",
    ]);
    expect(wrapPdfText("alpha beta gamma", 7, (value) => value.length)).toEqual(
      ["alpha ", "beta ", "gamma"],
    );
  });

  it("builds readable multi-page PDFs for long reports with tail content", async () => {
    const report = structuredClone(demoReport);
    report.clinicalContext.history = `${"Long fictional clinical history with café and Ω. ".repeat(200)} END-OF-HISTORY`;
    report.impression = ["Final user-entered statement — END-OF-REPORT"];
    const bytes = await generateReportPdf(report, fontBytes);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(pdf.getTitle()).toBe("Shoulder MRI Structured Research Report");
    expect(pdf.getSubject()).toBe(PDF_DISCLAIMER);
    expect(pdf.getForm().getFields()).toHaveLength(0);
    expect(
      reportSections(report)[1]
        .fields.find((field) => field.label === "Clinical history")
        ?.value.endsWith("END-OF-HISTORY"),
    ).toBe(true);
    expect(reportSections(report)[5].fields[0].value).toContain(
      "END-OF-REPORT",
    );
  }, 30_000);

  it("rejects unsupported glyphs clearly rather than silently corrupting text", async () => {
    const report = structuredClone(demoReport);
    report.clinicalContext.summary = "A user-entered unsupported character: 漢";
    await expect(generateReportPdf(report, fontBytes)).rejects.toThrow(
      "bundled PDF font cannot display",
    );
  });
});

describe("PDF summary provenance", () => {
  const summaryText = (report: typeof demoReport) =>
    reportSections(report)[1].fields.find(
      (field) => field.label === "Summary provenance / acceptance",
    )!.value;
  it("distinguishes manual and legacy summaries without claiming AI generation", () => {
    const report = structuredClone(demoReport);
    expect(summaryText(report)).toBe("Manually authored summary.");
    report.clinicalContext.summaryProvenance = { origin: "legacy-unknown" };
    expect(summaryText(report)).toContain("authorship was not recorded");
    expect(summaryText(report)).not.toContain("AI-assisted summary");
  });

  it("includes accepted model and review labels and detects changed source context", async () => {
    const { sourceFingerprint, summarySource } =
      await import("./summarySource");
    const report = structuredClone(demoReport);
    report.clinicalContext.summary = "Accepted summary text";
    report.clinicalContext.summaryProvenance = {
      origin: "ai-assisted",
      model: "qwen2.5:1.5b",
      generatedAt: "2026-11-12T14:30:00Z",
      acceptance: "user-accepted",
      sourceFingerprint: sourceFingerprint(
        summarySource(report.clinicalContext),
      ),
    };
    expect(summaryText(report)).toContain("model: qwen2.5:1.5b");
    expect(summaryText(report)).toContain(
      "user-accepted, not clinical approval",
    );
    expect(summaryText(report)).toContain("Source context matches");
    report.clinicalContext.notes = "New source information";
    expect(summaryText(report)).toContain("Source context has changed");
    report.clinicalContext.summaryProvenance.origin = "edited-ai-assisted";
    expect(summaryText(report)).toContain("Edited AI-assisted");
    const pdf = await PDFDocument.load(
      await generateReportPdf(report, fontBytes),
    );
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    expect(
      reportSections(report)[1].fields.find(
        (field) => field.label === "Patient summary",
      )?.value,
    ).toBe("Accepted summary text");
  });
});
