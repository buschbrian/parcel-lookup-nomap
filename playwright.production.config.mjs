import { defineConfig } from "@playwright/test";

/* Release-candidate smoke run against a deployed URL and the live public services.
   Separate from playwright.config.mjs on purpose: that suite serves `dist/` locally
   and mocks every ArcGIS response, so it proves the code and proves nothing about
   the deployment. This one starts no server, mocks nothing, and is the only check
   that exercises built-page-to-live-service — the seam MIGRATION.md left open.

   Run it against a candidate before promoting it:

     DEPLOY_URL=https://kind-grass-013e9611e.5.azurestaticapps.net/ \
       npm run test:production

   NO ARTEFACT CAPTURE. A trace, screenshot or video of a real lookup contains the
   owner name and mailing details the page displayed — actual resident data for a real
   parcel, captured into a file that CI would then upload. The evidence this run
   retains is deliberately structural only: timings, request counts, peak concurrency,
   pass/fail. Do not turn tracing on here to debug a failure; reproduce it locally
   against `dist/` with the mocked suite, which captures traces safely. */
export default defineConfig({
  testDir: "./tests",
  testMatch: "production.spec.mjs",
  // Live ArcGIS/FEMA, 20 layers, a cold Netlify edge and a slow municipal link:
  // generous, and the run reports its real timings so a slow candidate is visible.
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  // Retry once: this crosses the public internet, and a single transport blip is
  // not a release finding. A reproducible failure still fails.
  retries: 1,
  reporter: [["line"]],
  outputDir: "test-results-production",
  use: {
    baseURL: process.env.DEPLOY_URL,
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "off",
    screenshot: "off",
    video: "off"
  }
});
