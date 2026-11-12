import { test, expect, type Page } from "@playwright/test";
import { syntheticDicom } from "./syntheticDicom";

async function draft(page: Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save Draft (JSON)", exact: true })
    .click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString());
}

test("numeric windowing and manual rectangle editing, slice isolation, links and draft restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/#workspace");
  await page
    .getByLabel("Select DICOM files", { exact: true })
    .setInputFiles(
      [1, 2].map((i) => ({
        name: `pattern-${i}.dcm`,
        mimeType: "application/dicom",
        buffer: syntheticDicom(i),
      })),
    );
  const width = page.getByRole("spinbutton", {
    name: "Window width",
    exact: true,
  });
  const center = page.getByRole("spinbutton", {
    name: "Window center",
    exact: true,
  });
  await expect(width).toBeEnabled({ timeout: 60_000 });
  await width.fill("2000");
  await center.fill("1000");
  await expect(width).toHaveValue("2000");
  await expect(center).toHaveValue("1000");
  await page
    .getByRole("button", { name: "Reset Window/Level", exact: true })
    .click();
  await expect(width).toHaveValue("3500");
  await expect(center).toHaveValue("1750");
  await page.getByRole("button", { name: "Flag Region", exact: true }).click();
  const viewport = page.locator(".dicom-canvas");
  await viewport.scrollIntoViewIfNeeded();
  const bounds = await viewport.boundingBox();
  if (!bounds) throw new Error("Missing viewport");
  await page.mouse.move(
    bounds.x + bounds.width * 0.43,
    bounds.y + bounds.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.62,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await page
    .getByLabel("Region 1 description")
    .fill("Manual teaching region, no diagnostic claim.");
  await page
    .getByLabel("Region 1 linked finding", { exact: true })
    .selectOption("demo-finding-01");
  const saved = await draft(page);
  expect(saved.annotations[0]).toMatchObject({
    source: "manual",
    shape: "rectangle",
    description: "Manual teaching region, no diagnostic claim.",
    findingId: "demo-finding-01",
    reference: { frameNumber: 1, sliceIndex: 0 },
  });
  expect(saved.annotations[0].points).toHaveLength(4);
  const rectangles = page.locator(".dicom-canvas svg rect");
  await expect(rectangles.first()).toBeVisible();
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  await expect(rectangles).toHaveCount(0);
  await page.getByRole("button", { name: /Show linked region:/ }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 1 of 2" }),
  ).toBeVisible();
  await expect(rectangles.first()).toBeVisible();
  await page.getByRole("button", { name: "Next frame", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 2 of 2" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show region 1", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "DICOM image, frame 1 of 2" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Hide annotations", exact: true })
    .click();
  await expect(rectangles).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show annotations", exact: true })
    .click();
  await expect(rectangles.first()).toBeVisible();
  // View transforms change the rendered outline, never its stored world coordinates.
  await page.getByRole("button", { name: "Zoom", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const zoomBounds = await viewport.boundingBox();
  if (!zoomBounds) throw new Error("Missing viewport");
  const before = await rectangles.first().getAttribute("width");
  await page.mouse.move(
    zoomBounds.x + zoomBounds.width / 2,
    zoomBounds.y + zoomBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    zoomBounds.x + zoomBounds.width / 2,
    zoomBounds.y + zoomBounds.height / 2 - 55,
    { steps: 10 },
  );
  await page.mouse.up();
  await expect(rectangles.first()).not.toHaveAttribute("width", before!);
  expect((await draft(page)).annotations[0].points).toEqual(
    saved.annotations[0].points,
  );
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  // Native handle editing changes portable geometry while retaining references.
  await page.getByRole("button", { name: "Flag Region", exact: true }).click();
  await viewport.scrollIntoViewIfNeeded();
  const box = await rectangles.first().boundingBox();
  if (!box) throw new Error("Missing rectangle");
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 22, box.y - 18, { steps: 10 });
  await page.mouse.up();
  const edited = await draft(page);
  expect(edited.annotations[0].points).not.toEqual(saved.annotations[0].points);
  expect(edited.annotations[0].reference).toEqual(
    saved.annotations[0].reference,
  );
  await page
    .getByRole("button", { name: "Delete region 1", exact: true })
    .click();
  await expect(page.locator(".annotation-card")).toHaveCount(0);
  await expect(rectangles).toHaveCount(0);
  await page
    .getByLabel("Import report JSON")
    .setInputFiles({
      name: "regions.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
  await expect(page.locator(".annotation-card")).toHaveCount(1);
  await expect(rectangles.first()).toBeVisible();
  expect((await draft(page)).annotations[0]).toEqual(saved.annotations[0]);
  await page.screenshot({
    path: "/tmp/shoulder-v2-roi-workspace.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
