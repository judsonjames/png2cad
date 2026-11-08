/** Phones and tablets, in both orientations, with touch: the layout fits, the controls can be tapped, and gestures work. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

const sizes = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone on its side", width: 844, height: 390 },
  { name: "small tablet", width: 744, height: 1133 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "tablet on its side", width: 1180, height: 820 },
  { name: "large tablet", width: 1024, height: 1366 },
];

async function sample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try a Sample" }).click();
  await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Updating…")).toHaveCount(0, { timeout: 30_000 });
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: true, isMobile: size.width < 900 });

    test("fits the screen, keeps the picture large and the Make button in reach", async ({ page }) => {
      await sample(page);
      const m = await page.evaluate(() => {
        const art = document.querySelector('img[alt="The traced artwork"]')?.getBoundingClientRect();
        const make = [...document.querySelectorAll("button")].find((b) => /^Make /.test(b.textContent ?? ""));
        const r = make?.getBoundingClientRect();
        return {
          sideways: document.documentElement.scrollWidth - window.innerWidth,
          art: art ? Math.min(art.width, art.height) : 0,
          artTop: art?.top ?? 1e9,
          make: r ? r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth : false,
        };
      });
      expect(m.sideways).toBeLessThanOrEqual(0);
      expect(m.art).toBeGreaterThan(Math.min(size.width, size.height) * 0.5);
      expect(m.artTop).toBeLessThan(size.height);
      expect(m.make).toBe(true);
      await page.screenshot({ path: `../../out/shots/device-${size.name.replaceAll(" ", "-")}.png` });
    });

    test("gives every control a 44 px target and fields 16 px text", async ({ page }) => {
      await sample(page);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const describe = (e: Element) =>
          e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 30) ?? e.tagName;
        for (const e of document.querySelectorAll("button, [role=tab], select, input, [role=button]")) {
          const r = e.getBoundingClientRect();
          // Skip what is not on show, such as the inside of a closed details section.
          if (!r.width || !e.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
          // A checkbox or switch is tapped through the whole row it sits in.
          const target = (e as HTMLElement).closest("label") ?? e;
          const t = target.getBoundingClientRect();
          if (e.classList.contains("p2c-tip-marker")) {
            // The marker keeps its small circle; a tap anywhere in a 44 px square round it should still land on it.
            // Only a point on screen can be hit, so bring it into view first.
            e.scrollIntoView({ block: "center", inline: "center" });
            const m = e.getBoundingClientRect();
            const [x, y] = [m.left + m.width / 2, m.top + m.height / 2];
            const misses = [
              [18, 0],
              [-18, 0],
              [0, 18],
              [0, -18],
            ].filter(([dx, dy]) => {
              const hit = document.elementFromPoint(x + dx, y + dy);
              return !(hit === e || e.contains(hit));
            });
            if (misses.length) out.push(`tip marker ${describe(e)} misses taps at ${JSON.stringify(misses)}`);
            continue;
          }
          if (t.height < 44 || t.width < 44)
            out.push(`${describe(e)} is ${Math.round(t.width)} x ${Math.round(t.height)}`);
        }
        for (const e of document.querySelectorAll("input, select, textarea")) {
          const r = e.getBoundingClientRect();
          const type = (e as HTMLInputElement).type;
          if (!r.width || ["checkbox", "radio", "color"].includes(type)) continue;
          const font = parseFloat(getComputedStyle(e).fontSize);
          if (font < 16) out.push(`${describe(e)} has ${font} px text`);
        }
        return out;
      });
      expect(problems).toEqual([]);
    });
  });
}

test.describe("large images from drawing apps", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("are read at a size every device can handle, and say so", async ({ page }) => {
    // 6000 x 4000: larger than iOS Safari can read back from a canvas.
    const big = new PNG({ width: 6000, height: 4000 });
    big.data.fill(255);
    for (let y = 1000; y < 3000; y++) {
      for (let x = 2000; x < 4000; x++) big.data.fill(0, (y * 6000 + x) * 4, (y * 6000 + x) * 4 + 3);
    }
    const file = join(test.info().outputDir, "large-drawing.png");
    mkdirSync(test.info().outputDir, { recursive: true });
    writeFileSync(file, PNG.sync.write(big));
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect(page.getByText(/Read at 5016 x 3344 px, scaled down from 6000 x 4000 px/)).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole("img", { name: "The traced artwork" })).toBeVisible({ timeout: 60_000 });
  });
});

test.describe("touch gestures on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("pinching the picture zooms it, around the fingers", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "Real multi-touch input can only be sent in Chromium");
    await sample(page);
    const box = page.locator(".app-viewport-box").first();
    const content = page.locator(".app-viewport-content").first();
    const scaleOf = async () =>
      Number(/scale\(([\d.]+)\)/.exec((await content.evaluate((e) => (e as HTMLElement).style.transform)) ?? "")?.[1]);
    const before = await scaleOf();
    const r = (await box.boundingBox()) as { x: number; y: number; width: number; height: number };
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // Two real touches through the browser's own input, moving apart from 40 px to 160 px.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: number[][]) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    await touch("touchStart", [
      [cx - 20, cy],
      [cx + 20, cy],
    ]);
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", [
        [cx - 20 - i * 10, cy],
        [cx + 20 + i * 10, cy],
      ]);
    }
    await touch("touchEnd", []);
    const after = await scaleOf();
    expect(after / before).toBeGreaterThan(3.5);
    expect(after / before).toBeLessThan(4.5);
  });

  test("tapping an info marker opens its explanation", async ({ page }) => {
    await sample(page);
    const marker = page.getByRole("button", { name: "About Quick View" });
    await marker.tap();
    await expect(page.getByRole("tooltip").filter({ hasText: "coarser grid" })).toBeVisible();
  });

  test("makes a file from a phone", async ({ page }) => {
    await sample(page);
    await page.getByLabel("Output Width").fill("30");
    await page.getByRole("button", { name: "Make SVG" }).tap();
    await expect(page.getByRole("button", { name: /^Download .+\.svg$/ })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Do Not Use These Files Yet")).toHaveCount(0);
  });
});
