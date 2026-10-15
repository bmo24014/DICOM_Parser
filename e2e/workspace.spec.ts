import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import { syntheticDicom } from "./syntheticDicom";

test("landing, demo edits, JSON export/import, validation and responsive layout", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:5173") &&
      !request.url().startsWith("blob:") &&
      !request.url().startsWith("data:")
    )
      externalRequests.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A considered space/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Open Workspace/ }).click();
  await expect(page.getByText("Fictional example")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Import DICOM to test viewer" }),
  ).toBeVisible();
  const findings = page.locator(".finding-card");
  await findings
    .first()
    .getByLabel("Observation")
    .fill("Edited fictional observation for serialization test.");
  await findings.first().getByLabel("Laterality").selectOption("left");
  await findings.first().getByLabel("Review status").selectOption("reviewed");
  await findings
    .first()
    .getByLabel("Note")
    .fill("No measurements or diagnosis.");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export JSON/ }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const json = Buffer.concat(chunks);
  const report = JSON.parse(json.toString());
  expect(report.findings[0]).toMatchObject({
    observation: "Edited fictional observation for serialization test.",
    laterality: "left",
    reviewStatus: "reviewed",
    source: "simulated",
    note: "No measurements or diagnosis.",
  });
  expect(report.clinicalContext.fictional).toBe(true);
  await page.getByRole("button", { name: "Delete finding 1" }).click();
  await expect(findings).toHaveCount(1);
  await page.getByRole("button", { name: "Add finding" }).click();
  await expect(findings).toHaveCount(2);
  await page.getByLabel("Import report JSON").setInputFiles({
    name: "edited.json",
    mimeType: "application/json",
    buffer: json,
  });
  await expect(findings.first().getByLabel("Observation")).toHaveValue(
    report.findings[0].observation,
  );
  await page.getByLabel("Import report JSON").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(page.getByRole("alert")).toContainText("not valid JSON");
  await expect(findings.first().getByLabel("Observation")).toHaveValue(
    report.findings[0].observation,
  );
  await page.getByRole("button", { name: "Go to overview" }).click();
  await page.getByRole("button", { name: /Open Workspace/ }).click();
  await expect(findings.first().getByLabel("Observation")).toHaveValue(
    report.findings[0].observation,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: /Structured findings/ }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("local DICOM import decodes and renders an original synthetic pattern", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (!/^(http:\/\/127\.0\.0\.1:5173|blob:|data:)/.test(request.url()))
      externalRequests.push(request.url());
  });
  await page.goto("/#workspace");
  await page
    .locator(".finding-card")
    .first()
    .getByLabel("Observation")
    .fill("Edits must survive first image import.");
  await page.getByLabel("Select DICOM files", { exact: true }).setInputFiles([
    {
      name: "pattern-2.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(2),
    },
    {
      name: "pattern-1.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(1),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a DICOM image"),
    },
  ]);
  await expect(page.getByLabel("Study", { exact: true })).toContainText(
    "Study 1",
  );
  await expect(page.getByLabel("Series", { exact: true })).toContainText(
    "2 files",
  );
  await expect(page.getByText("Import notes (1)")).toBeVisible();
  const canvas = page.locator(".image-panel canvas").first();
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".image-panel")).not.toContainText("Unable to");
  // Wait until actual displayed pixels are varied and grayscale, rather than
  // accepting a PID, canvas element, or decoder success without rendering.
  await expect(async () => {
    const pixels = PNG.sync.read(await canvas.screenshot());
    const grays = new Set<number>();
    for (let i = 0; i < pixels.data.length; i += 4) {
      const [r, g, b] = pixels.data.subarray(i, i + 3);
      if (r === g && g === b && r > 15) grays.add(r);
    }
    expect(grays.size).toBeGreaterThan(15);
  }).toPass({ timeout: 45_000 });
  await expect(
    page.locator(".finding-card").first().getByLabel("Observation"),
  ).toHaveValue("Edits must survive first image import.");
  const firstImage = await canvas.screenshot();
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  expect((await canvas.screenshot()).equals(firstImage)).toBe(false);
  await page
    .getByRole("button", { name: "Previous frame", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 1 of 2" }),
  ).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Missing canvas bounds");
  for (const tool of ["Zoom", "Pan", "Window / level"]) {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await canvas.scrollIntoViewIfNeeded();
    const toolBounds = await canvas.boundingBox();
    if (!toolBounds) throw new Error("Missing canvas bounds");
    const toolX = toolBounds.x + toolBounds.width / 2;
    const toolY = toolBounds.y + toolBounds.height / 2;
    const before = await canvas.screenshot();
    await page.mouse.move(toolX, toolY);
    await page.mouse.down();
    await page.mouse.move(toolX + 55, toolY - 65, { steps: 10 });
    await page.mouse.up();
    expect(
      (await canvas.screenshot()).equals(before),
      `${tool} must change displayed pixels`,
    ).toBe(false);
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
  }
  await canvas.scrollIntoViewIfNeeded();
  const wheelBounds = await canvas.boundingBox();
  if (!wheelBounds) throw new Error("Missing canvas bounds");
  await page.mouse.move(
    wheelBounds.x + wheelBounds.width / 2,
    wheelBounds.y + wheelBounds.height / 2,
  );
  await page.mouse.wheel(0, 120);
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  expect(externalRequests).toEqual([]);
  await page.screenshot({
    path: "/tmp/shoulder-workspace-desktop.png",
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});

test("invalid local image files leave a helpful error", async ({ page }) => {
  await page.goto("/#workspace");
  await page.getByLabel("Select DICOM files", { exact: true }).setInputFiles({
    name: "not-an-image.dcm",
    mimeType: "application/dicom",
    buffer: Buffer.from("not DICOM"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "No readable image instances",
  );
  await expect(
    page.getByRole("heading", { name: "Import DICOM to test viewer" }),
  ).toBeVisible();
});

test("decoder errors preserve the report and allow another frame", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/#workspace");
  await page
    .locator(".finding-card")
    .first()
    .getByLabel("Observation")
    .fill("Keep this draft after decoder errors.");
  await page.getByLabel("Select DICOM files", { exact: true }).setInputFiles([
    {
      name: "broken-jpeg.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(1, "1.2.840.10008.1.2.4.50"),
    },
    {
      name: "valid-frame.dcm",
      mimeType: "application/dicom",
      buffer: syntheticDicom(2),
    },
  ]);
  await expect(page.getByRole("alert")).toContainText(
    "Image could not be displayed",
    { timeout: 30_000 },
  );
  await expect(
    page.locator(".finding-card").first().getByLabel("Observation"),
  ).toHaveValue("Keep this draft after decoder errors.");
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Zoom", exact: true }),
  ).toBeEnabled();
  expect(pageErrors).toEqual([]);
});
