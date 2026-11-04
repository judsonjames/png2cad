import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.ts",
  timeout: 240_000,
  workers: 1,
  outputDir: "../../out/playwright",
  reporter: "line",
  use: {
    baseURL: "http://localhost:5175",
    channel: "msedge",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run preview",
    port: 5175,
    reuseExistingServer: true,
  },
});
