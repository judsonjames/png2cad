/** The built static site, end to end: an image goes in, checked files come out, and nothing leaves the browser. */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { makeEach } from "./helpers";

const shots = join(import.meta.dirname, "..", "..", "..", "out", "shots");
const files = join(import.meta.dirname, "..", "..", "..", "out", "web-files");
const paperFolder = join(import.meta.dirname, "..", "..", "..", "out", "web-paper");

test("each file tab shows its own settings and makes only that file", async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(shots, { recursive: true });
  mkdirSync(paperFolder, { recursive: true });
  await page.goto("/");
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Output Width").fill("30");
  const files = page.getByRole("list", { name: "Files" }).getByRole("listitem");
  const lineWidth = page.getByRole("combobox", { name: "Line Width" });
  const perColor = page.getByText("Also Write One File per Color");
  const plateStyle = page.getByRole("group", { name: "Plate Style" });
  const nozzles = page.getByRole("group", { name: "Nozzles in Millimeters" });
  const view = (name: string) => page.getByRole("tab", { name, exact: true });

  // A round badge stays round: the page holds the whole curve, not just the points along it.
  await expect(page.getByText(/^30\.0 x 30\.0 mm/)).toBeVisible({ timeout: 30_000 });

  // SVG is the first tab: no nozzle, no plate, and nothing to fit.
  await expect(lineWidth).toBeVisible();
  await expect(perColor).toHaveCount(0);
  await expect(plateStyle).toHaveCount(0);
  await expect(nozzles).toHaveCount(0);
  await expect(view("Export Preview")).toHaveCount(0);
  await expect(view("3D Plate")).toHaveCount(0);
  await page.getByText("Trace Details").click();
  await expect(page.getByText("Curve Tolerance")).toBeVisible();
  await page.screenshot({ path: join(shots, "tab-svg.png") });
  await page.getByRole("button", { name: "Make SVG" }).click();
  await expect(files).toHaveCount(1, { timeout: 120_000 });
  await expect(files.getByText(/\.svg$/)).toHaveCount(1);

  await page.getByRole("tab", { name: "DXF" }).click();
  await expect(lineWidth).toHaveCount(0);
  await expect(page.getByText("Curve Tolerance")).toHaveCount(0);
  await expect(plateStyle).toHaveCount(0);
  await expect(perColor).toBeVisible();
  await expect(nozzles).toBeVisible();
  await expect(view("Export Preview")).toBeVisible();
  await expect(view("3D Plate")).toHaveCount(0);
  await expect(files).toHaveCount(0); // Files for another tab are out of date.
  await page.screenshot({ path: join(shots, "tab-dxf.png") });
  await page.getByRole("button", { name: "Make DXF" }).click();
  await expect(files).toHaveCount(1, { timeout: 120_000 });
  await expect(files.getByText(/\.dxf$/)).toHaveCount(1);

  await page.getByRole("tab", { name: "3MF" }).click();
  await expect(plateStyle).toBeVisible();
  await expect(nozzles).toBeVisible();
  await expect(lineWidth).toHaveCount(0);
  await expect(perColor).toHaveCount(0);
  await expect(view("3D Plate")).toBeVisible();
  await page.screenshot({ path: join(shots, "tab-3mf.png") });
  await page.getByRole("button", { name: "Make 3MF" }).click();
  await expect(files).toHaveCount(1, { timeout: 120_000 });
  await expect(files.getByText(/\.3mf$/)).toHaveCount(1);

  // For paper: the chosen unit comes first everywhere, and the SVG is written in it.
  await page.getByRole("tab", { name: "SVG" }).click();
  await page.getByLabel("Units").selectOption("in");
  await page.getByLabel("Output Width").fill("2");
  await expect(page.getByText(/^2\.00 x 2\.00 in \(50\.8 x 50\.8 mm\)/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Line Width" }).selectOption("width");
  await expect(page.getByRole("spinbutton", { name: "Smallest SVG Line" })).toHaveValue("0.0059");
  await page.getByRole("combobox", { name: "Line Width" }).selectOption("traced");
  await page.getByRole("button", { name: "Make SVG" }).click();
  await expect(files.getByText(/^2\.00 x 2\.00 in \(50\.8 x 50\.8 mm\), /)).toHaveCount(1, { timeout: 120_000 });
  const [saved] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Download .+\.svg$/ }).click(),
  ]);
  const paperFile = join(paperFolder, "badge_2in.svg");
  await saved.saveAs(paperFile);
  const stated = /<svg[^>]* width="([\d.]+)in" height="([\d.]+)in"/.exec(readFileSync(paperFile, "utf8"));
  console.log(`paper SVG states ${stated?.[1]} x ${stated?.[2]} in`);
  expect(Number(stated?.[1])).toBe(2);
  expect(Number(stated?.[2])).toBeCloseTo(2, 2);
  await page.getByLabel("Units").selectOption("mm");
  await page.getByLabel("Output Width").fill("30");
  await page.getByRole("tab", { name: "3MF", exact: true }).click();

  // A view that no longer applies goes away, and the picture falls back to the art.
  await view("3D Plate").click();
  await page.getByRole("tab", { name: "SVG" }).click();
  await expect(view("3D Plate")).toHaveCount(0);
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible();

  // The choice is remembered.
  await page.getByRole("tab", { name: "DXF" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("button", { name: "Make DXF" })).toBeVisible({ timeout: 60_000 });

  // Settings saved by an earlier version may name a choice that is gone. Planted before the page loads, since the app
  // saves its own settings as a sample finishes loading and could otherwise write over them.
  await page.addInitScript(() => localStorage.setItem("png2cad.settings", JSON.stringify({ output: "all" })));
  await page.reload();
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("button", { name: "Make SVG" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("tab", { name: "All Files" })).toHaveCount(0);
});

test("a sample becomes checked SVG, DXF and 3MF files", async ({ page }) => {
  test.setTimeout(1_500_000);
  mkdirSync(shots, { recursive: true });
  mkdirSync(files, { recursive: true });
  const problems: string[] = [];
  const offsite: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (!["localhost", ""].includes(url.hostname) && url.protocol !== "blob:" && url.protocol !== "data:") {
      offsite.push(r.url());
    }
  });

  await page.goto("/");
  await expect(page.getByText("Drop an Image Here")).toBeVisible();
  await page.screenshot({ path: join(shots, "1-empty.png") });

  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "DXF", exact: true }).click();
  await expect(page.getByText(/shapes, \d+ curve segments/)).toBeVisible();
  await page.screenshot({ path: join(shots, "2-traced.png") });

  await page.getByRole("tab", { name: "Export Preview" }).click();
  await page.getByRole("button", { name: "Check Size" }).click();
  await expect(page.getByRole("img", { name: "The export preview" })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/% of the art changed/)).toBeVisible();

  // Square art sits side by side rather than stacked.
  const started = Date.now();
  await page.getByText("Compare Sizes", { exact: true }).click();
  await expect(page.getByRole("img", { name: /^The export preview at / })).toHaveCount(3, { timeout: 480_000 });
  console.log(`comparing three-color art took ${Date.now() - started} ms`);
  await expect(page.locator(".app-compare-columns")).toBeVisible();
  await page.screenshot({ path: join(shots, "compare-columns.png") });
  await page.getByText("Compare Sizes", { exact: true }).click();
  await expect(page.getByRole("img", { name: "The export preview" })).toBeVisible();

  // The default size is 100 mm, and every file says so in the units it is written in.
  await makeEach(page, files, /^100\.0 x [\d.]+ mm \(/);
  await page.screenshot({ path: join(shots, "3-files.png"), fullPage: false });
  const list = page.getByRole("list", { name: "Files" });
  await expect(list.getByText(/^\d+\.\d x \d+\.\d x 3\.2 mm, /)).toHaveCount(1);

  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "4-plate.png") });

  await page.getByRole("tab", { name: "Source" }).click();
  await page.screenshot({ path: join(shots, "5-source.png") });

  expect(problems).toEqual([]);
  expect(offsite).toEqual([]);
});
