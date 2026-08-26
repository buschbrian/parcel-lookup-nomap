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
    baseURL: "http://127.0.0.1:4318",
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure"
  },
  webServer: {
    // Serve only the publish directory, so a local run cannot reach a file the
    // deployed site does not serve. Post ADR-0001 that directory is `dist/`,
    // the built artifact — `npm run test:e2e` builds first, so the suite
    // exercises exactly what deploys rather than unbuilt source.
    command: "python -m http.server 4318 --bind 127.0.0.1 --directory dist",
    url: "http://127.0.0.1:4318/index.html",
    /* Never reuse, anywhere. This was `!process.env.CI` — reuse locally, never in
       CI — and on 26 August 2026 the local half of that did exactly what the CI
       half was written to prevent: a `vite preview` from an unrelated project in
       another directory was listening on 4173, Playwright adopted it, and all 63
       tests failed with `CFG is not defined` against a stranger's page. Half an
       hour was spent looking for the change that broke the suite. Nothing had.

       The port moved off 4173 for the same reason: that is Vite's default preview
       port, so every Vite project on this machine contends for it. Starting a fresh
       server costs a fraction of a second and cannot be fooled. */
    reuseExistingServer: false,
    timeout: 15_000
  }
});

