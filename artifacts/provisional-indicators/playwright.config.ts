// Run the existing suite with installed Chrome when Playwright's bundled
// Chromium is unavailable. No application behavior is changed by this config.
import base from "../../frontend/playwright.config";
import { resolve } from "node:path";

export default {
  ...base,
  testDir: "../../frontend/e2e",
  outputDir: "../../frontend/test-results",
  // For Windows runners whose managed-server cleanup hangs, start `bun run dev`
  // in frontend separately and set PROVISIONAL_EXTERNAL_SERVER=1 for the tests.
  webServer: process.env.PROVISIONAL_EXTERNAL_SERVER ? undefined : {
    command: "bun run dev",
    cwd: resolve(__dirname, "../../frontend"),
    url: "http://localhost:3001",
    reuseExistingServer: true,
    timeout: 60000,
  },
  projects: base.projects?.map((project) => ({
    ...project,
    use: { ...project.use, channel: "chrome" },
  })),
};
