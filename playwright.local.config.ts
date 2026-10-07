import { defineConfig } from "@playwright/test";
import config from "./playwright.config";

export default defineConfig({
  ...config,
  testDir: "./tests/browser-local",
  projects: [{ name: "local-integration" }],
  webServer: { ...config.webServer, command: "node scripts/start-local-test-server.mjs", env: { MOCK_GOOGLE_SHEETS: "true" } },
});
