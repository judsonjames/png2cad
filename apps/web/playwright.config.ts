import { defineConfig } from "@playwright/test";

// Set PNG2CAD_URL to run the same tests against a deployed site instead of the local build.
const live = process.env.PNG2CAD_URL;

export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.ts",
  timeout: 240_000,
  workers: 1,
  outputDir: "../../out/playwright",
  reporter: "line",
  use: {
    baseURL: live ?? "http://localhost:5175",
    channel: "msedge",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    screenshot: "only-on-failure",
  },
  webServer: live
    ? undefined
    : {
        command: "npm run preview",
        port: 5175,
        reuseExistingServer: true,
      },
});
