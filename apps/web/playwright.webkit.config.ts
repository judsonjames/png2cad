import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The same tests in WebKit, the engine Safari uses on iPhone and iPad. Playwright's WebKit build is close to Safari on
 * iOS but not the same, so this narrows the gap without replacing a real device. Install it once with
 * `npx playwright install webkit`.
 */
export default defineConfig({
  ...base,
  outputDir: "../../out/playwright-webkit",
  use: { ...base.use, browserName: "webkit", channel: undefined },
});
