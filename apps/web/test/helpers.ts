import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

const anyFile = /^Download .+\.(svg|dxf|3mf)$/;

export async function saveAll(page: Page, folder: string) {
  mkdirSync(folder, { recursive: true });
  for (const button of await page.getByRole("button", { name: anyFile }).all()) {
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    await download.saveAs(join(folder, download.suggestedFilename()));
  }
}

/** Press the main button on the tab that is open, and wait for its file to pass its checks. */
export async function make(page: Page, name: string, timeout = 800_000) {
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("button", { name: anyFile }).first()).toBeVisible({ timeout });
  await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
}

/** Make each kind of file in turn, as a person would, and save them for the verifiers. Ends on the 3MF tab. */
export async function makeEach(page: Page, folder: string, sizes: RegExp) {
  const list = page.getByRole("list", { name: "Files" });
  for (const [tab, button] of [
    ["SVG", "Make SVG"],
    ["DXF", "Make DXF"],
    ["3MF", "Make 3MF"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await make(page, button);
    if (tab !== "3MF") await expect(list.getByText(sizes)).toHaveCount(1);
    await saveAll(page, folder);
  }
}
