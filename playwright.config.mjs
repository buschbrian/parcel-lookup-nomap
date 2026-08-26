import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.mjs",
  /* The release-candidate smoke run is not part of `npm test`. It has no server,
     mocks nothing, and requires DEPLOY_URL — running it here would point the
     deterministic suite at live public services and real resident data. It runs
     under playwright.production.config.mjs, deliberately and by hand. */
  testIgnore: "production.spec.mjs",
  timeout: 30_000,
  fullyParallel: false,
  reporter: process.env.CI
    ? [["line"],["html",{outputFolder:"playwright-report",open:"never"}]]
    : "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure"
  },
  webServer: {
    // Serve only the publish directory, so a local run cannot reach a file the
    // deployed site does not serve. Post ADR-0001 that directory is `dist/`,
    // the built artifact — `npm run test:e2e` builds first, so the suite
    // exercises exactly what deploys rather than unbuilt source.
    command: "python -m http.server 4173 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4173/index.html",
    // Locally, reuse a server that is already running. In CI, never: an unexpected
    // listener on this port would silently become the thing under test.
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  }
});

