import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fontUrl from "../assets/DejaVuSans.ttf?url";
import {
  FINDING_CATEGORIES,
  type ClinicalContext,
  type Report,
} from "../domain";
import { parseReport, serializeReport } from "./reports";
import { sourceFingerprint, summarySource } from "./summarySource";

export const PDF_DISCLAIMER =
  "Educational research prototype — Not for clinical use.";
export interface ReportSection {
  heading: string;
  fields: { label: string; value: string }[];
}
const provided = (value: string | undefined) =>
  value?.trim() ? value : "Not provided.";

function summaryLabel(context: ClinicalContext): string {
  const provenance = context.summaryProvenance;
  if (!("model" in provenance)) {
    return provenance.origin === "manual"
      ? "Manually authored summary."
      : "Legacy summary: authorship was not recorded. No AI provenance is inferred.";
  }
  const changed =
    sourceFingerprint(summarySource(context)) !== provenance.sourceFingerprint;
  return `${provenance.origin === "edited-ai-assisted" ? "Edited AI-assisted" : "AI-assisted"} summary; model: ${provenance.model}; generated: ${provenance.generatedAt}; user-accepted, not clinical approval. ${changed ? "Source context has changed since generation; review the summary again." : "Source context matches the generation fingerprint."}`;
}

/** One presentation model shared by all PDF pages. Empty fields stay explicit. */
export function reportSections(report: Report): ReportSection[] {
  const context = report.clinicalContext;
  return [
    {
      heading: "A. Examination Information",
      fields: [
        { label: "Report identifier", value: report.id },
        {
          label: "Case identifier (fictional or de-identified)",
          value: provided(context.caseIdentifier),
        },
        { label: "Examination type", value: provided(report.examination.type) },
        {
          label: "Laterality",
          value:
            report.examination.laterality === "unspecified"
              ? "Not provided."
              : report.examination.laterality,
        },
        { label: "Examination date", value: provided(report.examination.date) },
        {
          label: "Stored study UID reference",
          value: provided(report.studyInstanceUID),
        },
        {
          label: "Study reference note",
          value:
            "Verify the stored reference against the selected local study. A saved UID does not establish a patient match or clinical approval.",
        },
      ],
    },
    {
      heading: "B. Clinical History / Indication",
      fields: [
        {
          label: "Context provenance",
          value: `${context.provenance}; ${context.fictional ? "fictional example" : "user-supplied, unverified"}`,
        },
        {
          label: "Reason for examination / indication",
          value: provided(context.indication),
        },
        { label: "Clinical history", value: provided(context.history) },
        {
          label: "Patient summary",
          value: provided(context.summary),
        },
        {
          label: "Summary provenance / acceptance",
          value: summaryLabel(context),
        },
        {
          label: "Relevant symptoms / additional clinical notes",
          value: provided(context.notes),
        },
      ],
    },
    {
      heading: "C. Technique",
      fields: [
        {
          label: "Acquisition technique",
          value: provided(report.technique.acquisition),
        },
        {
          label: "Contrast information",
          value: provided(report.technique.contrast),
        },
      ],
    },
    {
      heading: "D. Comparison",
      fields: [
        { label: "Previous imaging", value: provided(report.comparison) },
      ],
    },
    {
      heading: "E. Findings",
      fields: FINDING_CATEGORIES.flatMap((category) => {
        const entries = report.findings.filter(
          (finding) => finding.category === category,
        );
        if (!entries.length)
          return [{ label: category, value: "Not provided." }];
        return entries.flatMap((finding, index) => [
          {
            label: `${category} — Finding ${index + 1}: ${provided(finding.structure)}`,
            value: provided(finding.observation),
          },
          {
            label: "Finding reference / laterality / source / user review",
            value: `${finding.id} / ${finding.laterality} / ${finding.source} / ${finding.reviewStatus}`,
          },
          { label: "Note", value: provided(finding.note) },
        ]);
      }),
    },
    {
      heading: "F. Impression",
      fields: report.impression.length
        ? report.impression.map((statement, index) => ({
            label: `${index + 1}.`,
            value: provided(statement),
          }))
        : [{ label: "Impression", value: "Not provided." }],
    },
    {
      heading: "G. Image Annotations",
      fields: report.annotations.length
        ? report.annotations.flatMap((annotation, index) => {
            const linked = report.findings.find(
              (finding) => finding.id === annotation.findingId,
            );
            const reference = annotation.reference;
            return [
              {
                label: `Manual rectangle ${index + 1} (${annotation.id})`,
                value: provided(annotation.description),
              },
              {
                label: "Study / series / image SOP instance UID",
                value: `${reference.studyInstanceUID}\n${reference.seriesInstanceUID}\n${reference.sopInstanceUID}`,
              },
              {
                label: "Image position",
                value: `Frame ${reference.frameNumber}; stack slice ${reference.sliceIndex + 1} (instance-number order)`,
              },
              {
                label: "Linked finding",
                value: linked
                  ? `${linked.id}: ${provided(linked.structure)} — ${provided(linked.observation)}`
                  : "Not provided.",
              },
            ];
          })
        : [{ label: "Manually flagged regions", value: "Not provided." }],
    },
    {
      heading: "H. Report Status",
      fields: [
        {
          label: "Workflow status",
          value: report.status === "reviewed" ? "User-reviewed" : "Draft",
        },
        {
          label: "Review limitation",
          value:
            "User review is a workflow label, not formal clinical approval. No physician signature is supplied.",
        },
        {
          label: "Format",
          value:
            "Locally generated printable PDF. Not a DICOM Structured Report. PDF edits do not synchronize with the application.",
        },
      ],
    },
  ];
}

/** Wrap every code point, including long words/UIDs, without dropping text. */
export function wrapPdfText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const result: string[] = [];
  const widths = new Map<string, number>();
  const measured = (value: string) => {
    let valueWidth = widths.get(value);
    if (valueWidth === undefined) {
      valueWidth = measure(value);
      widths.set(value, valueWidth);
    }
    return valueWidth;
  };
  for (const paragraph of text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n")) {
    if (!paragraph.length) {
      result.push("");
      continue;
    }
    let line = "";
    for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
      if (measured(line + token) <= width) {
        line += token;
        continue;
      }
      if (line) {
        result.push(line);
        line = "";
      }
      if (measured(token) <= width) {
        line = token;
        continue;
      }
      // UID-like and other unbroken text can exceed a full line.
      for (const character of token) {
        if (measured(character) > width)
          throw new Error("A PDF character is too wide for the report layout.");
        if (line && measured(line + character) > width) {
          result.push(line);
          line = "";
        }
        line += character;
      }
    }
    result.push(line);
  }
  return result;
}

function assertFontSupports(font: PDFFont, text: string) {
  const supported = new Set(font.getCharacterSet());
  for (const character of text) {
    if (character === "\n" || character === "\r" || character === "\t")
      continue;
    if (!supported.has(character.codePointAt(0)!)) {
      throw new Error(
        `The bundled PDF font cannot display ${JSON.stringify(character)} (U+${character.codePointAt(0)!.toString(16).toUpperCase()}). Use JSON to preserve this text or replace the unsupported character before exporting PDF.`,
      );
    }
  }
}

/** Flat, multi-page PDF. Pass local font bytes in tests; browsers fetch one local asset. */
export async function generateReportPdf(
  input: Report,
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  // Validate the same snapshot that JSON exports; never print a partial invalid report.
  const report = parseReport(serializeReport(input));
  const sections = reportSections(report);
  if (!fontBytes) {
    const response = await fetch(fontUrl);
    if (!response.ok)
      throw new Error(
        "The local PDF font could not be loaded. Save your JSON draft and retry.",
      );
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const title = "Shoulder MRI — Structured Research Report";
  assertFontSupports(
    font,
    [
      title,
      PDF_DISCLAIMER,
      ...sections.flatMap((section) => [
        section.heading,
        ...section.fields.flatMap((field) => [field.label, field.value]),
      ]),
    ].join("\n"),
  );
  pdf.setTitle("Shoulder MRI Structured Research Report");
  pdf.setSubject(PDF_DISCLAIMER);
  pdf.setCreator("Shoulder MRI Workspace (local browser export)");
  const width = 595.28,
    height = 841.89,
    margin = 48,
    bottom = 68;
  let page: PDFPage;
  let y = 0;
  const newPage = () => {
    page = pdf.addPage([width, height]);
    page.drawText(title, {
      x: margin,
      y: height - 43,
      size: 13,
      font,
      color: rgb(0.1, 0.2, 0.3),
    });
    page.drawLine({
      start: { x: margin, y: height - 55 },
      end: { x: width - margin, y: height - 55 },
      color: rgb(0.78, 0.83, 0.87),
      thickness: 0.6,
    });
    y = height - 80;
  };
  const line = (text: string, size: number, label = false) => {
    if (y - size < bottom) newPage();
    if (text)
      page.drawText(text, {
        x: margin,
        y,
        size,
        font,
        color: label ? rgb(0.22, 0.36, 0.48) : rgb(0.12, 0.17, 0.22),
      });
    y -= size * 1.5;
  };
  const paragraph = (text: string, size: number, label = false) => {
    for (const textLine of wrapPdfText(text, width - 2 * margin, (value) =>
      font.widthOfTextAtSize(value, size),
    ))
      line(textLine, size, label);
  };
  newPage();
  paragraph(PDF_DISCLAIMER, 10, true);
  y -= 8;
  for (const section of sections) {
    if (y < bottom + 75) newPage();
    paragraph(section.heading, 12, true);
    y -= 6;
    for (const field of section.fields) {
      if (y < bottom + 38) newPage();
      paragraph(field.label, 9, true);
      paragraph(field.value, 10);
      y -= 8;
    }
    y -= 10;
  }
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawLine({
      start: { x: margin, y: 49 },
      end: { x: width - margin, y: 49 },
      color: rgb(0.78, 0.83, 0.87),
      thickness: 0.5,
    });
    current.drawText(PDF_DISCLAIMER, {
      x: margin,
      y: 34,
      size: 7.4,
      font,
      color: rgb(0.35, 0.4, 0.45),
    });
    current.drawText(`${index + 1} / ${pages.length}`, {
      x: width - margin - 34,
      y: 34,
      size: 8,
      font,
      color: rgb(0.35, 0.4, 0.45),
    });
  });
  return pdf.save();
}
