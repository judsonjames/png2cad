/**
 * Real artwork through the real interface. The images are not part of this repository: set PNG2CAD_SAMPLES to a folder
 * holding them, or these tests skip.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const samples = process.env.PNG2CAD_SAMPLES ?? "";
const root = join(import.meta.dirname, "..", "..", "..", "out");
const shots = join(root, "shots");

async function saveAll(page: Page, folder: string) {
  mkdirSync(folder, { recursive: true });
  for (const button of await page.getByRole("button", { name: /^Download .+\.(svg|dxf|3mf)$/ }).all()) {
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    await download.saveAs(join(folder, download.suggestedFilename()));
  }
}

test("the truck line art", async ({ page }) => {
  const file = join(samples, "4451 truck.png");
  test.skip(!existsSync(file), "no sample images");
  mkdirSync(shots, { recursive: true });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Line Art" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Output Width").fill("100");
  await page.waitForTimeout(1500);
  await expect(page.getByText("Updating…")).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: join(shots, "truck-traced.png") });
  await page.getByRole("button", { name: "Make Files" }).click();
  await expect(page.getByRole("button", { name: /Download All/ })).toBeVisible({ timeout: 230_000 });
  await page.screenshot({ path: join(shots, "truck-files.png") });
  // At 100 mm this art is close to what a 0.4 mm nozzle can do, which is why it is the size tested here.
  await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Files" }).getByText(/^100\.0 x [\d.]+ mm, /)).toHaveCount(2);
  await saveAll(page, join(root, "web-truck"));
  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "truck-plate.png") });
});

test("a logo cropped out of a poster", async ({ page }) => {
  const file = join(samples, "interest meeting poster.png");
  test.skip(!existsSync(file), "no sample images");
  mkdirSync(shots, { recursive: true });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "Source" }).click();
  await page.screenshot({ path: join(shots, "poster-source.png") });
  await page.getByRole("button", { name: "Crop" }).click();
  const art = page.getByRole("img", { name: "The source" });
  const box = await art.boundingBox();
  if (!box) throw new Error("no source image");
  // The shield sits at about x 232-422, y 195-385 of the 452 x 678 poster.
  const at = (x: number, y: number) => [box.x + (x / 452) * box.width, box.y + (y / 678) * box.height] as const;
  await page.mouse.move(...at(232, 195));
  await page.mouse.down();
  await page.mouse.move(...at(422, 385), { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, "poster-cropped.png") });
  await page.getByRole("tab", { name: "Vector" }).click();
  await expect(page.getByText("Updating…")).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: join(shots, "poster-vector.png") });
  await page.getByRole("button", { name: "Make Files" }).click();
  await expect(page.getByRole("button", { name: /Download All/ })).toBeVisible({ timeout: 230_000 });
  await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
  await page.screenshot({ path: join(shots, "poster-files.png") });
  await saveAll(page, join(root, "web-poster"));
  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "poster-plate.png") });
});
