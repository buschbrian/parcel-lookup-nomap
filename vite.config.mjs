import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// This file is ESM (.mjs), so `__dirname` does not exist. Resolve entry points
// from the module URL instead of assuming a CommonJS global.
const here=path=>fileURLToPath(new URL(path,import.meta.url));

/* ADR-0001 step 1: introduce the build, move no application code.
   -----------------------------------------------------------------------
   Both pages stay separate public entry points. Nothing is extracted yet, so
   the built pages should be functionally identical to the current ones — that
   is the property this step exists to prove before anything is refactored.

   Layout this config assumes (see MIGRATION.md):

     index.html                 entry point, processed by Vite
     business-licensing.html    entry point, processed by Vite
     public/                    static passthrough, copied verbatim to dist/
       assets/millcreek-logo.png   -> /assets/millcreek-logo.png
       _headers                    -> /_headers   (Netlify reads it from dist/)
     dist/                      build output, the deployed artifact

   `public/` MUST NOT contain the entry HTML: Vite copies publicDir verbatim
   without processing, so an entry left there would silently bypass the build. */

export default defineConfig({
  // Repo root. `public/` is picked up as publicDir by Vite's default.
  root: ".",
  publicDir: "public",

  build: {
    outDir: "dist",
    emptyOutDir: true,

    // Step 1 only. The pages still carry plain (non-module) inline <script>,
    // which Vite passes through untouched; minifying would rewrite working code
    // this step is meant to leave alone. Turn this on once the extraction steps
    // have real module entries and the suite is green against them.
    minify: false,

    // Fail the build rather than silently emitting a page that lost an asset.
    assetsInlineLimit: 0,

    rollupOptions: {
      input: {
        index: here("index.html"),
        businessLicensing: here("business-licensing.html")
      }
    }
  },

  // `npm run preview` and the Playwright webServer both serve the built
  // artifact on this port, so tests exercise what actually deploys.
  preview: {
    port: 4173,
    host: "127.0.0.1",
    strictPort: true
  },

  server: {
    port: 5173,
    host: "127.0.0.1"
  }
});
