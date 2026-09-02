# Millcreek Property Lookup — Agent Routing

This file ROUTES; the rules live in the files below. Keep it short — read the
target file before touching the area it covers.

Two accessible, text-only municipal lookups for Millcreek, Utah, built as
self-contained HTML pages with a Vite build step and no runtime dependencies:
`index.html` (general property report — zoning, hazards, subdivision, district,
utilities) and `business-licensing.html` (short-term-rental parcel/buffer
screen). They exist as an accessible equivalent to a zoning web map that failed
independent screen-reader use. **Live in production** at
<https://lookup.gis.millcreekut.gov/>, serving Millcreek residents and staff.

## Working on X → read Y

| Working on | Read first |
|---|---|
| Page behavior, functions, data flow | `CODE.md` |
| Resident/staff/GIS-maintainer instructions | `USAGE.md` |
| A data source's owner, freshness, or replacement | `DATA-SOURCES.md` |
| Parity with the public Planning web map | `WEB-MAP-REVIEW.md` |
| The Vite/build migration's current state | `MIGRATION.md` |
| Cutting a release, version bump | `RELEASE.md` |
| A reported vulnerability | `SECURITY.md` |
| Azure hosting, cutover, rollback | `docs/azure-hosting.md` |
| An architecture decision (or a new one) | `docs/decisions/` |
| The NVDA manual screen-reader script | `docs/manual-screen-reader-test.md` |
| Why something used to work differently | `docs/changes/` (dated, historical) |
| A not-yet-built idea | `docs/ideas/` |

## Run and verify

```bash
npm ci
npm run dev                       # dev server; file:// breaks ArcGIS requests, don't use it
npm run build && npm run preview  # exercise the actual dist/ artifact
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"  # never download Playwright browsers here
npm test                          # unit + Python + browser; every ArcGIS call is mocked
npm run check:services            # live public ArcGIS contract check
npm run build && npm run check:deployment   # deployment allowlist, against dist/ or a URL
```

`npm test` proves the code, not a deployment. `npm run test:production` is the
one suite that hits live services against a deployed URL — it touches real
resident data (owner/mailing details) but blanks results before finishing; a
unit test enforces that. Don't run it casually.

## Deployment flow

`deploy-staging.yml` runs on every push to `main`: gates, builds, deploys to
the staging Static Web App automatically, no approval. `promote-production.yml`
is manual-only (`workflow_dispatch` with a staging run id): it builds and
tests nothing, republishing the exact gated artifact behind the `production`
environment's required reviewer. `verify-deployment.yml` checks a already-
deployed URL (staging or post-promotion production) and holds no credential.
**Brian is the sole approver on `production`, and that is intentional** — see
`docs/decisions/0002-host-on-azure-static-web-apps.md`.

## Invariants (from tests/CI)

1. Each production page stays self-contained: no runtime deps, third-party
   values render via `textContent`, only validated http(s)/tel links.
2. The version string must agree across `package.json`, and `CFG.release.
   version` in both pages — a unit test fails otherwise.
3. Missing data renders as `Unknown`, never a false negative; one failed
   layer must not blank the rest of the page.
4. Response headers are declared twice — `public/_headers` (Netlify) and
   `public/staticwebapp.config.json` (Azure) — a test compares them
   header-by-header; edit both together.
5. Only the entry pages, their assets, and `public/` reach `dist/`;
   `check:deployment` enforces that allowlist against a live URL.
6. `npm run check:services` / `live-service-monitor.yml` distinguish
   transport failure (retry) from real contract drift (never retried,
   never softened) — don't blur that distinction when editing either.

## Don't

- Add a JS framework, bundler runtime, or npm dependency shipped to
  production — the self-contained-page constraint is deliberate (`CODE.md`).
- Collapse staging and production into one workflow, or give
  `deploy-staging.yml` reach to the production credential.
- Renumber findings in `docs/changes/*.md` — they're cross-referenced
  elsewhere as `§N`.
- Invent or "improve" a data source without updating `DATA-SOURCES.md` and
  its tests together.
