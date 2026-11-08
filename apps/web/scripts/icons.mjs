/**
 * Draws the home screen icons from public/favicon.svg, so the installed app and the browser tab share one design.
 * Run after changing the favicon: `node scripts/icons.mjs` from apps/web. Needs Playwright's Edge, as the tests do.
 *
 * - Full-bleed squares for iOS and Android, which round the corners themselves.
 * - A maskable icon with the art inside the middle 80%, the part every launcher's mask keeps.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const here = join(import.meta.dirname, "..", "public");
const source = readFileSync(join(here, "favicon.svg"), "utf8");
const background = /<rect[^>]*fill="(#[0-9a-f]{6})"/.exec(source)?.[1] ?? "#1b1210";
// The favicon's own corners are rounded; an app icon must be a full square.
const square = source.replace(/<rect([^>]*)\srx="[\d.]+"/, "<rect$1");
const icons = [
  { name: "apple-touch-icon.png", size: 180, inset: 0 },
  { name: "icon-192.png", size: 192, inset: 0 },
  { name: "icon-512.png", size: 512, inset: 0 },
  { name: "icon-maskable-512.png", size: 512, inset: 0.1 },
];

mkdirSync(join(here, "icons"), { recursive: true });
const browser = await chromium.launch({ channel: "msedge" });
for (const icon of icons) {
  const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
  const art = icon.size * (1 - 2 * icon.inset);
  const svg = square.replace("<svg ", `<svg width="${art}" height="${art}" `);
  await page.setContent(
    `<!doctype html><body style="margin:0;background:${background};display:grid;place-items:center;height:100vh">${svg}</body>`,
  );
  await page.screenshot({ path: join(here, "icons", icon.name) });
  await page.close();
}
await browser.close();
console.log(`drew ${icons.length} icons on ${background}`);
