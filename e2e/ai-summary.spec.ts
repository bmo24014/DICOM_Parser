import { expect, test, type Page, type Route } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

// Deterministic provider stubs exercise UI behavior, not real model inference.
const MODEL = "qwen2.5:1.5b";
const GENERATED_AT = "2026-11-12T16:00:00.000Z";
const contextRegion = (page: Page) =>
  page.getByRole("region", { name: "Clinical context", exact: true });
const summaryField = (page: Page) =>
  contextRegion(page).getByRole("textbox", {
    name: "Patient summary",
    exact: true,
  });
const proposedField = (page: Page) =>
  page.getByRole("textbox", { name: "Proposed AI summary", exact: true });
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
const acceptance = (page: Page) =>
  page.getByRole("checkbox", {
    name: "I reviewed this AI draft and want to replace Patient summary.",
    exact: true,
  });

async function reply(route: Route, status: number, value: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}
async function stubStatus(page: Page) {
  await page.route("**/api/ai/status", (route) =>
    reply(route, 200, { model: MODEL }),
  );
}
async function download(page: Page, name: string | RegExp): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name, exact: typeof name === "string" })
    .click();
  const result = await pending;
  expect(await result.failure()).toBeNull();
  const stream = await result.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function saveDraft(page: Page) {
  return JSON.parse((await download(page, "Save Draft (JSON)")).toString());
}
async function importDraft(page: Page, value: unknown) {
  await page.getByLabel("Import report JSON").setInputFiles({
    name: "ai-draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)),
  });
}
async function seedContext(page: Page) {
  await contextRegion(page)
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill(
      "Fictional adult with six months of left shoulder discomfort during overhead activity. No previous shoulder surgery.",
    );
  await contextRegion(page)
    .getByRole("textbox", {
      name: "Reason for examination / indication",
      exact: true,
    })
    .fill("Review the supplied history for this fictional software case.");
  await contextRegion(page)
    .getByRole("textbox", {
      name: "Relevant symptoms / additional notes",
      exact: true,
    })
    .fill(
      "Symptoms described during overhead activity; no additional symptoms supplied.",
    );
  await summaryField(page).fill("MANUAL_SUMMARY_MUST_SURVIVE");
}

test("stubbed local AI sends only permitted context, requires acceptance, and exports accepted provenance", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests: { method: string; url: string; data: unknown }[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/ai/"))
      requests.push({
        method: request.method(),
        url: request.url(),
        data: request.postDataJSON(),
      });
  });
  await stubStatus(page);
  await page.route("**/api/ai/summary", (route) =>
    reply(route, 200, {
      text: "AI_PROPOSAL_UNACCEPTED_SENTINEL",
      model: MODEL,
      generatedAt: GENERATED_AT,
    }),
  );
  await page.goto("/#workspace");
  expect(requests).toHaveLength(0);
  await seedContext(page);
  await contextRegion(page)
    .getByRole("textbox", { name: "Case identifier", exact: true })
    .fill("CASE_IDENTIFIER_MUST_NOT_BE_SENT");
  await page
    .locator(".finding-card")
    .first()
    .getByRole("textbox", { name: "Observation", exact: true })
    .fill("FINDING_MUST_NOT_BE_SENT");
  await button(page, "Check local AI").click();
  await expect(contextRegion(page)).toContainText(MODEL);
  await button(page, "Generate AI Summary").click();
  await expect(proposedField(page)).toHaveValue(
    "AI_PROPOSAL_UNACCEPTED_SENTINEL",
  );
  await expect(contextRegion(page)).toContainText(
    "AI-generated draft — review before use",
  );
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  await expect(button(page, "Accept AI summary")).toBeDisabled();
  const inference = requests.filter((item) =>
    item.url.endsWith("/api/ai/summary"),
  );
  expect(inference).toHaveLength(1);
  expect(inference[0].data).toEqual({
    history:
      "Fictional adult with six months of left shoulder discomfort during overhead activity. No previous shoulder surgery.",
    indication: "Review the supplied history for this fictional software case.",
    notes:
      "Symptoms described during overhead activity; no additional symptoms supplied.",
  });
  const pendingDraft = await saveDraft(page);
  expect(pendingDraft.clinicalContext.summary).toBe(
    "MANUAL_SUMMARY_MUST_SURVIVE",
  );
  expect(JSON.stringify(pendingDraft)).not.toContain(
    "AI_PROPOSAL_UNACCEPTED_SENTINEL",
  );
  const pendingPdf = await download(page, /Export PDF/);
  await writeFile("/tmp/shoulder-ai-unaccepted.pdf", pendingPdf);
  await proposedField(page).fill(
    "AI_BROWSER_ACCEPTED_SUMMARY — fictional left shoulder context, with no prior surgery described.",
  );
  await acceptance(page).check();
  await button(page, "Accept AI summary").click();
  await expect(summaryField(page)).toHaveValue(
    "AI_BROWSER_ACCEPTED_SUMMARY — fictional left shoulder context, with no prior surgery described.",
  );
  const acceptedDraft = await saveDraft(page);
  expect(acceptedDraft.schemaVersion).toBe(3);
  expect(acceptedDraft.clinicalContext.provenance).toBe("manual");
  expect(acceptedDraft.clinicalContext.summaryProvenance).toMatchObject({
    origin: "edited-ai-assisted",
    model: MODEL,
    generatedAt: GENERATED_AT,
    acceptance: "user-accepted",
  });
  expect(
    acceptedDraft.clinicalContext.summaryProvenance.sourceFingerprint,
  ).toMatch(/^[a-f0-9]{64}$/);
  const pdfBytes = await download(page, /Export PDF/);
  expect((await PDFDocument.load(pdfBytes)).getPageCount()).toBeGreaterThan(0);
  await writeFile("/tmp/shoulder-ai-browser.pdf", pdfBytes);
  await writeFile(
    "/tmp/shoulder-ai-browser.json",
    JSON.stringify(acceptedDraft, null, 2),
  );
  await summaryField(page).fill("AI_BROWSER_EDITED_SUMMARY");
  const edited = await saveDraft(page);
  expect(edited.clinicalContext.summaryProvenance).toMatchObject({
    ...acceptedDraft.clinicalContext.summaryProvenance,
    origin: "edited-ai-assisted",
  });
  await importDraft(page, acceptedDraft);
  await expect(summaryField(page)).toHaveValue(
    acceptedDraft.clinicalContext.summary,
  );
  expect((await saveDraft(page)).clinicalContext.summaryProvenance).toEqual(
    acceptedDraft.clinicalContext.summaryProvenance,
  );
  expect(errors).toEqual([]);
});

test("stubbed proposals can be discarded and source edits require regeneration", async ({
  page,
}) => {
  await stubStatus(page);
  let count = 0;
  await page.route("**/api/ai/summary", (route) =>
    reply(route, 200, {
      text: `PROPOSAL_${++count}`,
      model: MODEL,
      generatedAt: GENERATED_AT,
    }),
  );
  await page.goto("/#workspace");
  await seedContext(page);
  await button(page, "Generate AI Summary").click();
  await expect(proposedField(page)).toHaveValue("PROPOSAL_1");
  await button(page, "Discard AI summary").click();
  await expect(proposedField(page)).toHaveCount(0);
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  await button(page, "Generate AI Summary").click();
  await expect(proposedField(page)).toHaveValue("PROPOSAL_2");
  await contextRegion(page)
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill("Changed fictional history.");
  await expect(contextRegion(page)).toContainText(/changed|stale/i);
  await expect(button(page, "Accept AI summary")).toBeDisabled();
  await button(page, "Regenerate AI summary").click();
  await expect(proposedField(page)).toHaveValue("PROPOSAL_3");
  await acceptance(page).check();
  await button(page, "Accept AI summary").click();
  await expect(summaryField(page)).toHaveValue("PROPOSAL_3");
  const accepted = await saveDraft(page);
  expect(accepted.clinicalContext.summaryProvenance.origin).toBe("ai-assisted");
  await contextRegion(page)
    .getByRole("textbox", {
      name: "Relevant symptoms / additional notes",
      exact: true,
    })
    .fill("Changed after acceptance.");
  await expect(contextRegion(page)).toContainText(/changed/i);
  expect(
    (await saveDraft(page)).clinicalContext.summaryProvenance.sourceFingerprint,
  ).toBe(accepted.clinicalContext.summaryProvenance.sourceFingerprint);
});

test("stubbed pending requests cancel safely, reject stale results, and prevent concurrent generation", async ({
  page,
}) => {
  await stubStatus(page);
  let release: (() => void) | undefined;
  let requestCount = 0;
  await page.route("**/api/ai/summary", async (route) => {
    const current = ++requestCount;
    if (current <= 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await reply(route, 200, {
      text: `LATE_RESULT_${current}`,
      model: MODEL,
      generatedAt: GENERATED_AT,
    }).catch(() => {});
  });
  await page.goto("/#workspace");
  await seedContext(page);
  await button(page, "Generate AI Summary").click();
  await expect(button(page, "Cancel generation")).toBeVisible();
  await expect(button(page, "Generate AI Summary")).toBeDisabled();
  await expect.poll(() => requestCount).toBe(1);
  await button(page, "Cancel generation").click();
  release?.();
  await expect(contextRegion(page)).toContainText(/cancelled|canceled/i);
  await expect(proposedField(page)).toHaveCount(0);
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  await button(page, "Generate AI Summary").click();
  await expect.poll(() => requestCount).toBe(2);
  await contextRegion(page)
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill("New source while request pending.");
  release?.();
  await expect(contextRegion(page)).toContainText(/changed|stale/i);
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  if (await button(page, "Regenerate AI summary").count())
    await button(page, "Regenerate AI summary").click();
  else await button(page, "Generate AI Summary").click();
  await expect(proposedField(page)).toHaveValue("LATE_RESULT_3");
  expect(requestCount).toBe(3);
});

test("stubbed availability, model, timeout, and malformed-response failures retain manual work", async ({
  page,
}) => {
  let status = 503;
  let value: unknown = {
    error: "Local Ollama server unavailable. Start Ollama and retry.",
  };
  await page.route("**/api/ai/status", (route) => reply(route, status, value));
  await page.route("**/api/ai/summary", (route) => reply(route, status, value));
  await page.goto("/#workspace");
  await seedContext(page);
  await button(page, "Check local AI").click();
  await expect(contextRegion(page)).toContainText(/unavailable|start ollama/i);
  status = 404;
  value = {
    error: `Model ${MODEL} is not installed. Pull the model and retry.`,
  };
  await button(page, "Check local AI").click();
  await expect(contextRegion(page)).toContainText(
    /not installed|missing model/i,
  );
  status = 200;
  value = { model: MODEL };
  await button(page, "Check local AI").click();
  await page.unroute("**/api/ai/summary");
  await page.route("**/api/ai/summary", (route) =>
    reply(route, 504, {
      error: "Local AI request timed out. Retry or use manual editing.",
    }),
  );
  await button(page, "Generate AI Summary").click();
  await expect(contextRegion(page)).toContainText(/timed out|timeout/i);
  await page.unroute("**/api/ai/summary");
  await page.route("**/api/ai/summary", (route) =>
    reply(route, 200, { text: "", model: MODEL, generatedAt: GENERATED_AT }),
  );
  await button(page, "Generate AI Summary").click();
  await expect(contextRegion(page)).toContainText(/empty|invalid|malformed/i);
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  expect((await saveDraft(page)).findings).toHaveLength(2);
  await contextRegion(page)
    .getByRole("textbox", { name: "Clinical history", exact: true })
    .fill("");
  await contextRegion(page)
    .getByRole("textbox", {
      name: "Reason for examination / indication",
      exact: true,
    })
    .fill("");
  await contextRegion(page)
    .getByRole("textbox", {
      name: "Relevant symptoms / additional notes",
      exact: true,
    })
    .fill("");
  await expect(button(page, "Generate AI Summary")).toBeDisabled();
});

test("importing the same report ID clears unaccepted AI proposals without automatic inference", async ({
  page,
}) => {
  await stubStatus(page);
  let requests = 0;
  await page.route("**/api/ai/summary", (route) => {
    requests++;
    return reply(route, 200, {
      text: "PROPOSAL_RESET_ON_IMPORT",
      model: MODEL,
      generatedAt: GENERATED_AT,
    });
  });
  await page.goto("/#workspace");
  await seedContext(page);
  const original = await saveDraft(page);
  await button(page, "Generate AI Summary").click();
  await expect(proposedField(page)).toHaveValue("PROPOSAL_RESET_ON_IMPORT");
  await importDraft(page, original);
  await expect(proposedField(page)).toHaveCount(0);
  await expect(summaryField(page)).toHaveValue("MANUAL_SUMMARY_MUST_SURVIVE");
  expect((await saveDraft(page)).id).toBe(original.id);
  expect(requests).toBe(1);
});
