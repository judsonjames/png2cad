/** The installable app: what a home screen needs, opening without a connection, and the share sheet. */
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { make } from "./helpers";

test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

async function sample(page: Page) {
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Output Width").fill("30");
}

test("has what a home screen needs: a manifest, icons and the iOS tags", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const base = new URL(page.url());
  const manifestUrl = new URL(href as string, base);
  const manifest = await (await request.get(manifestUrl.href)).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("./");
  const sizeOf = async (url: URL) => {
    const res = await request.get(url.href);
    expect(res.ok()).toBe(true);
    const png = PNG.sync.read(await res.body());
    return `${png.width}x${png.height}`;
  };
  for (const icon of manifest.icons) expect(await sizeOf(new URL(icon.src, manifestUrl))).toBe(icon.sizes);
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === "maskable")).toBe(true);
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  expect(await sizeOf(new URL(apple as string, base))).toBe("180x180");
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
});

test("opens and makes files with no connection, once visited", async ({ page, context, browserName }) => {
  await page.goto("/");
  // Wait until the service worker has kept every file and controls the page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((done) => navigator.serviceWorker.addEventListener("controllerchange", done, { once: true }));
    }
  });
  // Playwright's own offline switch in Chromium also blocks what the service worker serves from its cache, so there the
  // browser's network emulation is used, as DevTools does. WebKit's switch behaves like a device with no connection.
  const goOffline = async (offline: boolean) => {
    if (browserName !== "chromium") return context.setOffline(offline);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  };
  await goOffline(true);
  await page.reload();
  await expect(page.getByText("Drop an Image Here")).toBeVisible();
  await sample(page);
  await make(page, "Make SVG");
  // The 3MF needs the geometry kernel, a separate file loaded only when it is used.
  await page.getByRole("tab", { name: "3MF", exact: true }).click();
  await make(page, "Make 3MF");
  // Nothing went to the server while offline: everything came from what the app kept.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await goOffline(false);
});

test("shares a file through the share sheet, and still offers the download", async ({ page }) => {
  // Stand in for the device's share sheet, and record what it was given.
  await page.addInitScript(() => {
    const shared: { name: string; type: string; size: number }[] = [];
    Object.assign(window, { shared });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    Object.defineProperty(navigator, "share", {
      value: async (data: { files: File[] }) => {
        for (const f of data.files) shared.push({ name: f.name, type: f.type, size: f.size });
      },
      configurable: true,
    });
  });
  await page.goto("/");
  await sample(page);
  await make(page, "Make SVG");
  const name = (await page.getByRole("list", { name: "Files" }).locator(".app-file-name").first().textContent()) ?? "";
  await expect(page.getByRole("button", { name: `Download ${name}` })).toBeVisible();
  await page.screenshot({ path: "../../out/shots/share-button.png" });
  await page.getByRole("button", { name: `Share ${name}` }).click();
  const shared = await page.evaluate(
    () => (window as unknown as { shared: { name: string; type: string; size: number }[] }).shared,
  );
  expect(shared).toHaveLength(1);
  expect(shared[0].name).toBe(name);
  expect(shared[0].type).toBe("image/svg+xml");
  expect(shared[0].size).toBeGreaterThan(1000);
});

test("does not offer Share where the device cannot share files", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
  });
  await page.goto("/");
  await sample(page);
  await make(page, "Make SVG");
  await expect(page.getByRole("button", { name: /^Share / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Download .+\.svg$/ })).toBeVisible();
});
