/**
 * Real artwork through the real interface. The images are not part of this repository: set PNG2CAD_SAMPLES to a folder
 * holding them, or these tests skip.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { make, makeEach, saveAll } from "./helpers";

const samples = process.env.PNG2CAD_SAMPLES ?? "";
const root = join(import.meta.dirname, "..", "..", "..", "out");
const shots = join(root, "shots");

test("the truck line art", async ({ page }) => {
  test.setTimeout(1_500_000);
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
  // At 100 mm this art is close to what a 0.4 mm nozzle can do, which is why it is the size tested here.
  await makeEach(page, join(root, "web-truck"), /^100\.0 x [\d.]+ mm \(/);
  await page.screenshot({ path: join(shots, "truck-files.png") });
  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "truck-plate.png") });
});

test("the export preview waits for Check Size and matches the files", async ({ page }) => {
  const file = join(samples, "4451 truck.png");
  test.skip(!existsSync(file), "no sample images");
  mkdirSync(shots, { recursive: true });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "DXF", exact: true }).click();
  const width = page.getByLabel("Output Width");
  await width.fill("100");
  const check = page.getByRole("button", { name: "Check Size" });
  const bar = page.getByRole("progressbar");

  // Opening the tab starts nothing.
  await page.getByRole("tab", { name: "Export Preview" }).click();
  await expect(page.getByText("See What Your Files Will Look Like")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(bar).toHaveCount(0);
  await page.screenshot({ path: join(shots, "preview-empty.png") });

  const started = Date.now();
  await check.click();
  await expect(bar).toBeVisible();
  await page.screenshot({ path: join(shots, "preview-fitting.png") });
  const preview = page.getByRole("img", { name: "The export preview" });
  await expect(preview).toBeVisible({ timeout: 120_000 });
  console.log(`preview at 100 mm took ${Date.now() - started} ms`);
  const changed = page.locator(".app-view-note", { hasText: "of the art changed" });
  const percent = async () => Number(/([\d.]+)% of the art/.exec((await changed.textContent()) ?? "")?.[1]);
  await page.screenshot({ path: join(shots, "preview-100.png") });
  const at100 = await percent();
  expect(at100).toBeGreaterThan(10);
  await expect(check).toBeDisabled();

  // Typing a size one digit at a time starts nothing, and the old picture says it is out of date.
  await width.fill("");
  await width.pressSequentially("127", { delay: 700 });
  const outdated = page.getByText("Settings changed since this preview");
  await expect(outdated).toBeVisible();
  await expect(preview).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(bar).toHaveCount(0);

  // A check can be stopped, and changing a setting stops one too.
  await check.click();
  await expect(bar).toBeVisible();
  await page.getByRole("button", { name: "Cancel Check" }).click();
  await expect(bar).toHaveCount(0);
  await expect(outdated).toBeVisible();
  await check.click();
  await expect(bar).toBeVisible();
  await width.fill("128");
  await expect(bar).toHaveCount(0);
  await width.fill("127");

  // The bar moves on through the fit rather than stopping at the start of it.
  const refit = Date.now();
  await check.click();
  await expect(bar).toBeVisible();
  const reached = () => bar.evaluate((e) => (e as HTMLProgressElement).value).catch(() => 1);
  await expect.poll(reached, { intervals: [100], timeout: 60_000 }).toBeGreaterThan(0.6);
  await page.screenshot({ path: join(shots, "preview-updating.png") });
  await expect(preview).toBeVisible(); // The old picture stays until the new one arrives.
  await expect(bar).toHaveCount(0, { timeout: 120_000 });
  console.log(`preview at 127 mm took ${Date.now() - refit} ms`);
  await expect(outdated).toHaveCount(0);
  await page.screenshot({ path: join(shots, "preview-127.png") });
  const at127 = await percent();
  expect(at127).toBeLessThan(at100);
  await expect(page.getByText("127.0 x", { exact: false })).toBeVisible();

  await make(page, "Make DXF");
  expect(await percent()).toBe(at127);
  await expect(page.getByRole("list", { name: "Files" }).getByText(/^127\.0 x [\d.]+ mm \(/)).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("comparing sizes shows what a larger print keeps", async ({ page }) => {
  const file = join(samples, "4451 truck.png");
  test.skip(!existsSync(file), "no sample images");
  mkdirSync(shots, { recursive: true });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "DXF", exact: true }).click();
  await page.getByLabel("Output Width").fill("100");
  await page.getByRole("tab", { name: "Export Preview" }).click();
  await page.getByRole("button", { name: "Check Size" }).click();
  await expect(page.getByRole("img", { name: "The export preview" })).toBeVisible({ timeout: 120_000 });
  await page.getByText("Compare Sizes", { exact: true }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText(/^Updating: size 1 of 2/)).toBeVisible();
  await page.screenshot({ path: join(shots, "compare-working.png") });
  const pictures = page.getByRole("img", { name: /^The export preview at / });
  await expect(pictures).toHaveCount(3, { timeout: 200_000 });
  await expect(page.getByText("Updating…")).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: join(shots, "compare-sizes.png") });

  const percentIn = async (name: string) => {
    const text = await page.getByRole("region", { name }).locator(".app-view-note").textContent();
    return Number(/([\d.]+)% of the art/.exec(text ?? "")?.[1]);
  };
  const [at100, at125, at150] = [
    await percentIn("100 mm wide"),
    await percentIn("125 mm wide"),
    await percentIn("150 mm wide"),
  ];
  expect(at125).toBeLessThan(at100);
  expect(at150).toBeLessThan(at125);

  // Zooming one picture zooms them all.
  const content = page.locator(".app-viewport-content");
  await page.getByRole("button", { name: "Zoom In" }).first().click();
  const transforms = await content.evaluateAll((list) => list.map((e) => (e as HTMLElement).style.transform));
  expect(new Set(transforms).size).toBe(1);

  // Choosing a size keeps the fit already made, and the files agree with it.
  await page.getByRole("button", { name: "Use 125 mm wide" }).click();
  await expect(page.getByLabel("Output Width")).toHaveValue("125");
  const single = page.getByRole("img", { name: "The export preview" });
  await expect(single).toBeVisible();
  await expect(page.getByText(/^Updating/)).toHaveCount(0, { timeout: 3_000 });
  await make(page, "Make DXF");
  const note = await page.locator(".app-view-note", { hasText: "of the art changed" }).textContent();
  expect(Number(/([\d.]+)% of the art/.exec(note ?? "")?.[1])).toBe(at125);
  await expect(page.getByRole("list", { name: "Files" }).getByText(/^125\.0 x [\d.]+ mm \(/)).toHaveCount(1);
  expect(problems).toEqual([]);
});

test("an SVG with a smallest line, previewed and checked", async ({ page }) => {
  const file = join(samples, "4451 truck.png");
  test.skip(!existsSync(file), "no sample images");
  test.setTimeout(600_000);
  mkdirSync(shots, { recursive: true });
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Output Width").fill("100");

  // The quick picture says what it is, and full detail is one click away.
  await expect(page.getByText("Quick view", { exact: true })).toBeVisible();
  await expect(page.getByText("Updating…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "Show Full Detail" }).click();
  await expect(page.getByText("Full detail", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: join(shots, "vector-full.png") });

  // An SVG as traced has no fit to check, so the tab is not offered until a smallest line is set.
  await expect(page.getByRole("tab", { name: "Export Preview" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Line Width" }).selectOption("width");
  await expect(page.getByRole("spinbutton", { name: "Smallest SVG Line" })).toHaveValue("0.15");
  await page.getByRole("tab", { name: "Export Preview" }).click();
  await page.getByRole("button", { name: "Check Size" }).click();
  await expect(page.getByRole("img", { name: "The export preview" })).toBeVisible({ timeout: 200_000 });
  await page.screenshot({ path: join(shots, "line-preview.png") });

  await page.getByRole("button", { name: "Make SVG" }).click();
  await expect(page.getByRole("button", { name: /Download/ }).first()).toBeVisible({ timeout: 230_000 });
  await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
  await expect(page.getByText("4451_truck_line0.15.svg")).toBeVisible();
  await saveAll(page, join(root, "web-line"));
});

test("a logo cropped out of a poster", async ({ page }) => {
  test.setTimeout(1_800_000); // Three files, and on a machine short of memory each runs several times slower.
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
  await makeEach(page, join(root, "web-poster"), /^100\.0 x [\d.]+ mm \(/);
  await page.screenshot({ path: join(shots, "poster-files.png") });
  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "poster-plate.png") });
});
