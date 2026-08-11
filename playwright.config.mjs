import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure"
  },
  webServer: {
    // Serve only the publish directory, so a local run cannot reach a file the
    // deployed site does not serve.
    command: "python -m http.server 4173 --bind 127.0.0.1 --directory public",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: true,
    timeout: 15_000
  }
});

