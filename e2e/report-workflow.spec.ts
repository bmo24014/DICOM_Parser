import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { syntheticDicom } from "./syntheticDicom";

async function downloadBytes(
  page: Page,
  action: string | RegExp,
): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: action, exact: typeof action === "string" })
    .click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function importDraft(page: Page, json: Buffer | string) {
  await page.getByLabel("Import report JSON").setInputFiles({
    name: "research-draft.json",
    mimeType: "application/json",
    buffer: typeof json === "string" ? Buffer.from(json) : json,
  });
}

test("editable context and structured sections restore through JSON and export a multipage PDF", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (!/^(http:\/\/127\.0\.0\.1:5173|blob:|data:)/.test(request.url()))
      externalRequests.push(request.url());
  });
  await page.goto("/#workspace");
  const context = page.getByRole("region", {
    name: "Clinical context",
    exact: true,
  });
  await expect(context).toContainText("Simulated");
  const history =
    Array.from(
      { length: 260 },
      (_, i) =>
        `Synthetic research history line ${i + 1}: overhead activity context.\n`,
    ).join("") + "BROWSER_HISTORY_TAIL_SENTINEL";
  await context
    .getByRole("textbox", { name: "Case identifier", exact: true })
    .fill("RESEARCH_CASE_BROWSER_42");
  await context
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill(history);
  await context
    .getByRole("textbox", {
      name: "Reason for examination / indication",
      exact: true,
    })
    .fill("Browser-authored indication for software testing.");
  await context
    .getByRole("textbox", { name: "Patient summary", exact: true })
    .fill("Browser-authored summary — manually entered.");
  await context
    .getByRole("textbox", {
      name: "Relevant symptoms / additional notes",
      exact: true,
    })
    .fill("BROWSER_NOTES_LATEST_VALUE");
  await context.getByLabel("This is fictional context").uncheck();
  await expect(context).toContainText("Manually entered");
  await page
    .getByRole("textbox", { name: "Examination type", exact: true })
    .fill("Shoulder MRI software test examination");
  await page
    .getByLabel("Examination laterality", { exact: true })
    .selectOption("left");
  await page.getByLabel("Examination date", { exact: true }).fill("2026-11-01");
  await page.getByText("C. Technique", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "MRI acquisition technique", exact: true })
    .fill("Technique entered solely for software testing.");
  await page
    .getByRole("textbox", { name: "Contrast information", exact: true })
    .fill("Contrast information supplied manually.");
  await page.getByText("D. Comparison", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "Previous imaging studies", exact: true })
    .fill("No comparison supplied for this fictional test.");
  const firstFinding = page.locator(".finding-card").first();
  await firstFinding
    .getByRole("textbox", { name: "Observation", exact: true })
    .fill("BROWSER_FINDING_LATEST_VALUE");
  await firstFinding
    .getByLabel("Laterality", { exact: true })
    .selectOption("left");
  await firstFinding
    .getByLabel("Source", { exact: true })
    .selectOption("clinician entered");
  await firstFinding
    .getByLabel("Review status", { exact: true })
    .selectOption("reviewed");
  await page
    .getByRole("button", { name: "Add impression statement", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Impression 1", exact: true })
    .fill("BROWSER_IMPRESSION_LATEST_VALUE — authored for software testing.");
  await page
    .getByLabel("Report status", { exact: true })
    .selectOption("reviewed");

  const jsonBytes = await downloadBytes(page, "Save Draft (JSON)");
  const draft = JSON.parse(jsonBytes.toString());
  expect(draft.schemaVersion).toBe(3);
  expect(draft.clinicalContext).toMatchObject({
    caseIdentifier: "RESEARCH_CASE_BROWSER_42",
    history,
    indication: "Browser-authored indication for software testing.",
    summary: "Browser-authored summary — manually entered.",
    notes: "BROWSER_NOTES_LATEST_VALUE",
    provenance: "manual",
    fictional: false,
  });
  expect(draft.examination).toEqual({
    type: "Shoulder MRI software test examination",
    laterality: "left",
    date: "2026-11-01",
  });
  expect(draft.technique).toEqual({
    acquisition: "Technique entered solely for software testing.",
    contrast: "Contrast information supplied manually.",
  });
  expect(draft.comparison).toBe(
    "No comparison supplied for this fictional test.",
  );
  expect(draft.findings[0]).toMatchObject({
    category: "Rotator cuff",
    observation: "BROWSER_FINDING_LATEST_VALUE",
    laterality: "left",
    source: "clinician entered",
    reviewStatus: "reviewed",
  });
  expect(draft.impression).toEqual([
    "BROWSER_IMPRESSION_LATEST_VALUE — authored for software testing.",
  ]);
  expect(draft.status).toBe("reviewed");
  expect(draft).not.toHaveProperty("studyInstanceUID");

  await context
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill("Temporary replacement");
  await page
    .getByRole("textbox", { name: "Examination type", exact: true })
    .fill("Temporary examination");
  await importDraft(page, jsonBytes);
  await expect(
    context.getByRole("textbox", { name: "Clinical history", exact: true }),
  ).toHaveValue(history);
  await expect(
    context.getByRole("textbox", { name: "Patient summary", exact: true }),
  ).toHaveValue(draft.clinicalContext.summary);
  await expect(
    page.getByRole("textbox", { name: "Examination type", exact: true }),
  ).toHaveValue(draft.examination.type);
  await expect(
    page.getByRole("textbox", { name: "Impression 1", exact: true }),
  ).toHaveValue(draft.impression[0]);
  expect(
    JSON.parse((await downloadBytes(page, "Save Draft (JSON)")).toString()),
  ).toEqual(draft);

  const pdfBytes = await downloadBytes(page, /Export PDF/);
  expect(pdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBeGreaterThan(3);
  expect(pdf.getSubject()).toBe(
    "Educational research prototype — Not for clinical use.",
  );
  await writeFile("/tmp/shoulder-v2-browser.pdf", pdfBytes);
  await writeFile("/tmp/shoulder-v2-browser.json", jsonBytes);
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("original version 1 JSON migrates without losing authored text or provenance", async ({
  page,
}) => {
  await page.goto("/#workspace");
  const legacy = {
    schemaVersion: 1,
    id: "legacy-browser-report",
    studyInstanceUID: "1.2.3.legacy",
    clinicalContext: {
      id: "legacy-context",
      fictional: true,
      history: "LEGACY_HISTORY_PRESERVED",
      summary: "LEGACY_SUMMARY_PRESERVED",
    },
    findings: [
      {
        id: "legacy-finding",
        structure: "Legacy structure",
        observation: "LEGACY_OBSERVATION_PRESERVED",
        laterality: "right",
        reviewStatus: "reviewed",
        source: "simulated",
        note: "Legacy optional note",
      },
    ],
  };
  await importDraft(page, JSON.stringify(legacy));
  await expect(
    page.getByRole("textbox", { name: "Clinical history", exact: true }),
  ).toHaveValue(legacy.clinicalContext.history);
  await expect(
    page.getByRole("textbox", { name: "Patient summary", exact: true }),
  ).toHaveValue(legacy.clinicalContext.summary);
  await expect(
    page.getByRole("region", { name: "Clinical context", exact: true }),
  ).toContainText("Imported");
  await expect(
    page
      .locator(".finding-card")
      .getByRole("textbox", { name: "Observation", exact: true }),
  ).toHaveValue(legacy.findings[0].observation);
  await expect(
    page.getByText(
      "Imported or previously saved reference; verify before associating.",
      { exact: true },
    ),
  ).toBeVisible();
  const migrated = JSON.parse(
    (await downloadBytes(page, "Save Draft (JSON)")).toString(),
  );
  expect(migrated.schemaVersion).toBe(3);
  expect(migrated.id).toBe(legacy.id);
  expect(migrated.studyInstanceUID).toBe(legacy.studyInstanceUID);
  expect(migrated.clinicalContext).toMatchObject(legacy.clinicalContext);
  expect(migrated.clinicalContext.provenance).toBe("imported");
  expect(migrated.findings[0]).toMatchObject(legacy.findings[0]);
  expect(migrated.annotations).toEqual([]);
  expect(migrated.impression).toEqual([]);
  expect(migrated.examination).toEqual({
    type: "",
    laterality: "unspecified",
    date: "",
  });
  await importDraft(page, JSON.stringify({ ...migrated, schemaVersion: 999 }));
  await expect(page.getByRole("alert")).toContainText(
    "Unsupported report schemaVersion",
  );
  await expect(
    page.getByRole("textbox", { name: "Clinical history", exact: true }),
  ).toHaveValue(legacy.clinicalContext.history);
});

test("study association requires explicit confirmation and imported saved references require rechecking", async ({
  page,
}) => {
  await page.goto("/#workspace");
  await page
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill("Context stays independently authored while navigating images.");
  await page.getByLabel("Select DICOM files", { exact: true }).setInputFiles([
    {
      name: "association-frame-1.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(1),
    },
    {
      name: "association-frame-2.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(2),
    },
  ]);
  await expect(
    page.getByRole("button", { name: "Next frame", exact: true }),
  ).toBeEnabled({ timeout: 30_000 });
  await expect(
    page.getByText("This report is not associated with an image study.", {
      exact: true,
    }),
  ).toBeVisible();
  const confirm = page.getByRole("button", {
    name: "Confirm study association",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  const selectedStudyUID = await page
    .getByLabel("Study", { exact: true })
    .inputValue();
  const independent = JSON.parse(
    (await downloadBytes(page, "Save Draft (JSON)")).toString(),
  );
  expect(independent).not.toHaveProperty("studyInstanceUID");
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Clinical history", exact: true }),
  ).toHaveValue(independent.clinicalContext.history);
  await page
    .getByLabel(
      "I have verified this report and context belong with the selected study.",
    )
    .check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByText("Association confirmed in this session.", { exact: true }),
  ).toBeVisible();
  const associatedBytes = await downloadBytes(page, "Save Draft (JSON)");
  const associated = JSON.parse(associatedBytes.toString());
  expect(associated.studyInstanceUID).toBe(selectedStudyUID);
  await importDraft(page, associatedBytes);
  await expect(
    page.getByText(
      "Imported or previously saved reference; verify before associating.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Association confirmed in this session.", { exact: true }),
  ).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  const afterImport = JSON.parse(
    (await downloadBytes(page, "Save Draft (JSON)")).toString(),
  );
  expect(afterImport.studyInstanceUID).toBe(associated.studyInstanceUID);
  expect(afterImport.clinicalContext.history).toBe(
    independent.clinicalContext.history,
  );
});
