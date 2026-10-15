import { defineConfig } from "@playwright/test";
import { REPOSITORY_ROOT } from "./lib/project-paths.mjs";

export default defineConfig({
  testDir: "../test/browser",
  outputDir: "../test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    browserName: "chromium",
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "node scripts/preview-fictional.mjs",
    cwd: REPOSITORY_ROOT,
    url: "http://127.0.0.1:4175",
    reuseExistingServer: false,
    timeout: 30000,
    env: { FAMILY_PREVIEW_PORT: "4175", FAMILY_TREE_PASSWORD: "", FAMILY_TREE_NEW_PASSWORD: "" }
  }
});
