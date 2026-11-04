/** The built static site, end to end: an image goes in, checked files come out, and nothing leaves the browser. */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const shots = join(import.meta.dirname, "..", "..", "..", "out", "shots");
const files = join(import.meta.dirname, "..", "..", "..", "out", "web-files");

test("a sample becomes checked SVG, DXF and 3MF files", async ({ page }) => {
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
  await expect(page.getByText(/shapes, \d+ curve segments/)).toBeVisible();
  await page.screenshot({ path: join(shots, "2-traced.png") });

  await page.getByRole("button", { name: "Make Files" }).click();
  await expect(page.getByRole("button", { name: /Download All/ })).toBeVisible({ timeout: 200_000 });
  await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
  await page.screenshot({ path: join(shots, "3-files.png"), fullPage: false });

  const names = await page.getByRole("list", { name: "Files" }).getByRole("listitem").count();
  expect(names).toBeGreaterThanOrEqual(3);
  for (const button of await page.getByRole("button", { name: /^Download .+\.(svg|dxf|3mf)$/ }).all()) {
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    await download.saveAs(join(files, download.suggestedFilename()));
  }

  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, "4-plate.png") });

  await page.getByRole("tab", { name: "Source" }).click();
  await page.screenshot({ path: join(shots, "5-source.png") });

  expect(problems).toEqual([]);
  expect(offsite).toEqual([]);
});
