/**
 * The built site as a static host serves it: from a subfolder, exact files only, with no fallback page. The preview
 * server answers a missing file with the app itself, which hides broken paths; this one answers 404.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { expect, test } from "@playwright/test";
import { make } from "./helpers";

const dist = join(import.meta.dirname, "..", "dist");
const port = 5176;
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

let server: Server;
const missing: string[] = [];

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    if (!path.startsWith("/png2cad/")) {
      missing.push(path);
      res.writeHead(404).end();
      return;
    }
    const rel = normalize(path.slice("/png2cad/".length) || "index.html");
    const file = join(dist, rel);
    if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
      missing.push(path);
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(port, done));
});

test.afterAll(() => new Promise((done) => server.close(done)));

test("works from a subfolder, with every file found", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  await page.goto(`http://localhost:${port}/png2cad/`);
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("tab", { name: "3MF", exact: true }).click();
  await make(page, "Make 3MF");
  await page.getByRole("tab", { name: "3D Plate" }).click();
  await expect(page.getByRole("img", { name: /3D view of the plate/ })).toBeVisible({ timeout: 30_000 });
  expect(missing).toEqual([]);
  expect(problems).toEqual([]);
});
