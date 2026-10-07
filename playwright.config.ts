import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm exec next start --port 3100", url: "http://127.0.0.1:3100", reuseExistingServer: false, timeout: 60000,
  },
});
