# Millcreek Property Lookup

Two accessible, text-only lookups for Millcreek, Utah. The general property report returns zoning,
future land use, subdivision, hazard, district and utility information. A separate business-
licensing page screens published short-term-rental parcels and 400-foot buffers. Neither requires a
map, mouse, or vision.

Live: <https://lookup.gis.millcreekut.gov/>

Millcreek homepage: <https://millcreekut.gov/>

This README is in two halves. Everything above "Working on this" is for anyone who uses the service,
reviews it, or wants to understand what it reports and how far it can be trusted. Everything below
is for people changing the code.

---

## Why this exists

Millcreek is a public entity subject to **ADA Title II, 28 CFR Part 35 Subpart H**, which establishes
WCAG 2.1 Level A and AA requirements for state and local government web content. The Department of
Justice's 2026 interim final rule extended the compliance date for entities with a population of
50,000 or more to **26 April 2027**. See the
[DOJ fact sheet](https://www.ada.gov/resources/2024-03-08-web-rule/) and
[current rule materials](https://www.ada.gov/law-and-regs/regulations/title-ii-2010-regulations/).

Interactive maps are among the hardest parts of that obligation. Canvas-based maps can be made more
accessible with names, keyboard interaction and equivalent programmatic content, but the City's
production zoning application did not expose the information and controls needed for independent
screen-reader use when it was measured:

| Check | Result |
|:--|:--|
| Headings | 0 |
| Landmarks | 0 |
| Buttons with no accessible name | 241 of 666 |
| Search input programmatically labelled | No |
| Status regions (`aria-live`) | 0 |
| Map `<canvas>` accessible name | none |

The practical design question was:

> **What service is this map delivering, and how else can we deliver that service?**

This application provides a direct text lookup for the key property determinations people commonly
seek from the map. The visual map remains available for people who prefer it, and links here as its
own accessible equivalent.

The legal treatment of a separate version is fact-specific. Section 35.202 limits conforming
alternate versions to technical or legal limitations; §35.203 addresses equivalent facilitation;
and §35.204 governs web-specific fundamental-alteration and undue-burden duties. This repository
does not make that legal determination. Millcreek's ADA/accessibility lead and legal counsel must
review the service as part of the City's wider compliance program.

---

## What it does

Enter an address (`3300 East Santa Rosa Avenue`) or a 14-digit parcel number, and get:

- **Property record** — address, parcel number, acreage, property type, year built, building area,
  housing units, tax district, owner of record
- **Hazard and special designations** — current Wildland-Urban Interface and Sensitive Land Area,
  queried against the full parcel as explicit Yes/No results
- **Zoning** — base zone, future land use / General Plan designation and City Center Overlay
- **Historic designation** — district name, National Register status/listing year, and whether a
  separate Millcreek local ordinance designation applies
- **Subdivision and plat** — plat name, plat number, and a link to the recorded plat PDF
- **Natural hazards** — live FEMA NFHL zone/subtype detail, comparison with Millcreek's public-map
  flood layer, and the surface fault rupture special-study-area designation
- **Informational hazard screening** — mapped liquefaction potential, debris-flow screening areas
  and alluvial-fan deposits, explicitly separated from ordinance-driven determinations
- **Representation** — City Council district and council member
- **Services** — culinary water provider, sewer district, electrical provider and waste collection day

Plus **copy as plain text**, **print**, and a staffed fallback with a published response time.

`business-licensing.html` is deliberately narrower. It reports only whether the selected parcel
appears in the June 2026 published short-term-rental layer and whether the full parcel intersects a
400-foot buffer belonging to another published rental. It excludes the selected parcel's own
buffer and directs applicants to Business Licensing for a current, official determination.

---

## Accessibility

Built to WCAG 2.1 AA, with WCAG 2.2 target-size and focus criteria met where the marginal cost was
zero.

- Semantic HTML first; ARIA only where HTML cannot express the pattern
- Address entry implements the **ARIA 1.2 combobox pattern** — `aria-expanded`, `aria-controls`,
  `aria-activedescendant`, full arrow / Home / End / Escape / Enter handling. Not a `<datalist>`,
  which is inconsistently supported by screen readers
- Every result announced through an `aria-live` status region (4.1.3)
- Focus moves to the results heading after a lookup
- Status **never** conveyed by colour alone — always glyph **and** word **and** colour (1.4.1)
- Reflows to 320 px with no two-dimensional scrolling (1.4.10), and at 200% text (1.4.4). Long
  unbreakable tokens — 14-digit parcel numbers, email addresses — are allowed to break, which is
  what stops them forcing horizontal scrolling when text is enlarged
- Programmatic focus targets (the results heading, and the main region via the skip link) carry an
  explicit `:focus` outline, because `:focus-visible` does not match programmatic focus (2.4.7)
- Interactive targets ≥ 44 × 44 px (2.5.8)
- Visible focus indicator at 3 px, never removed (2.4.7)
- Respects `prefers-reduced-motion` and `prefers-color-scheme`
- No `<canvas>`, no `<iframe>`, no browser storage
- Automated unit, browser and axe checks cover structure, keyboard behavior, deterministic ArcGIS
  responses, result semantics, copying, contrast and common accessibility failures

**Keyboard pass: done** (13 August 2026). It found three defects the automated suite structurally
could not — horizontal scrolling once text was enlarged, no visible focus indicator on the
programmatic focus targets, and a status region that could be announced partially. All three are
fixed in both pages and covered by regression tests. See `CHANGES-2026-08-13.md`.

**Not yet verified: the screen-reader pass.** Automated testing catches roughly 25–40% of WCAG
issues, so **no public conformance claim should be made until it is complete.** The remaining checks
are written up as a runnable script at
[`docs/manual-screen-reader-test.md`](docs/manual-screen-reader-test.md) — about an hour with NVDA,
and it needs no prior accessibility expertise.

If JavaScript is unavailable the lookup cannot run, but the staffed fallback — phone, email,
response-time commitment — is static HTML and still renders. The service degrades to a human, not
to a broken page.

---

## Accessibility problems and feedback

Report anything that prevents you getting the information you need:

- Phone **801-214-2754**
- Email **<gis@millcreekut.gov>**
- Commitment: an accessible format **within 5 business days**

Bugs and enhancements: open an issue in this repository.

---

## Data sources

Most local queries go to Millcreek's ArcGIS Online feature services at
`services9.arcgis.com/XRrSFvEwSsReIxuA`. Flood classifications are queried directly from FEMA's
National Flood Hazard Layer and compared with the flood layer in the public Planning map. Surface
fault rupture uses that map's special-study-area polygon. The Content Security Policy permits the
Millcreek and FEMA origins; adding another host requires adding its origin to **both** host
configuration files — see "Deploying and releasing" below.

| Data | Origin |
|:--|:--|
| Parcels, ownership, valuation | Salt Lake County |
| Addresses | Utah Geospatial Resource Center (UGRC), Salt Lake County |
| Zoning, overlays, future land use, subdivisions | Millcreek |
| Flood hazard | FEMA |
| Surface fault rupture special-study area | Utah Geological Survey (UGS) data published by Millcreek |
| Liquefaction, debris flow and alluvial fans | Public-map geologic layers; only liquefaction explicitly credits UGS/UGRC |
| Short-term-rental parcels and 400-foot buffers | Millcreek Business Licensing data published on ArcGIS Online matching the interactive map |
| Utility service areas | Utah Division of Drinking Water, UGRC, providers |

### On data quality

Utility boundaries are compiled from third-party products and can contain gaps, overlaps and other
topological defects. Utility results still use the stored parcel point. FEMA flood, the fault
special-study area, WUI, Sensitive Land and historic results use the **full parcel boundary**, so partial
intersection is no longer missed by a centroid-only query.

Standing disclaimers are shown with every Services, Natural hazards and Informational hazard
screening result. They are in `CFG.GROUP_NOTES` and should not be removed. The informational public-
map layers are generalized context and are not presented as ordinance determinations. The
licensing page has its own permanent dated-snapshot and decision caveat.

Every configured service, field and ownership contact is recorded in
[DATA-SOURCES.md](DATA-SOURCES.md). Older-named zoning, future-land-use and WUI sources must not be
changed merely because a newer-looking ArcGIS item exists; GIS/Planning approval and result
comparison are required first.

---

## Known limitations

1. **Some results remain centroid-based.** Zoning, future land use, subdivisions, representation
   and utilities use the stored parcel point. FEMA flood, the fault special-study area, WUI, Sensitive Land
   and historic designations use the full parcel boundary.
2. **The currently linked recorded plat PDFs are scanned drawings** and are not screen-reader
   accessible. The app identifies that limitation and offers staff to read or describe the needed
   dimensions and easements.
3. **Sensitive Land Areas has no attributes**, so the app can report *that* a property is in one but
   not *which* constraint applies. This affects 62.4% of parcels and is the highest-priority data
   gap.
4. **66 parcels have no address** and are reachable only by parcel number.
5. **Requires JavaScript.** Degrades to the staffed fallback.

---

## Disclaimer

This tool reports the data of record. It is **not** a zoning verification letter, **not** a flood
determination for lending or insurance purposes, and **not** a determination that a property can be
developed. For a binding determination contact
[Planning & Zoning](https://millcreekut.gov/151/Planning-Zoning) at **801-214-2700** or
**<planner@millcreekut.gov>**. The GIS accessibility/help contact remains 801-214-2754.

Full disclaimer of warranty and liability is published in the application footer and follows
Millcreek's adopted data disclaimer.

---

## Working on this

Everything below is for people changing the code.

### Quick start

The required release toolchain is **Node 22.15.0 with npm 10.9.2**. `.nvmrc` is the single source
for the Node version consumed by developers and GitHub Actions; load that version before installing
dependencies. The same contract is mirrored in `package.json` (`engines` and `packageManager`) and
in this paragraph; a drift test covers all three, so update them together.

```bash
git clone https://github.com/buschbrian/parcel-lookup-nomap.git
cd parcel-lookup-nomap
npm ci
npm run dev        # dev server on http://127.0.0.1:5173
```

To look at what actually deploys rather than the dev server:

```bash
npm run build      # writes dist/
npm run preview    # serves dist/ on http://127.0.0.1:4173
```

> **Do not test by double-clicking `index.html`.** Over `file://` the browser blocks the
> cross-origin request to ArcGIS, so every lookup fails even though the service is fine. The app
> detects this and says so on load, but you still need a local server to test lookups. Layout
> and print styles are fine to check over `file://`.

The build is a verified pass-through — `dist/index.html` and `dist/business-licensing.html` are
byte-identical to their sources — so `python3 -m http.server 8080 --directory dist` also serves the
artifact if you would rather not use Vite's preview.

### Checks

```bash
npx playwright install chromium
npm test                  # unit, Python and browser suites; every ArcGIS response mocked
npm run check:services    # live public ArcGIS contract check
npm run build             # check:deployment compares against dist/, so build first
npm run check:deployment  # against production, or any DEPLOY_URL
```

`npm test` mocks every ArcGIS response, so it proves the code and nothing about a deployment.
`npm run test:production` is the one check that does not mock: it looks up the published synthetic
address on a deployed URL against the live services, scans each results page with axe, and reports
timings and request counts to `production-evidence/`.

> **It touches real resident data, so it retains none.** The address is a synthetic fixture, but the
> parcel it returns is real — owner name and mailing details. Tracing, screenshots and video are
> off, the assertions count fields rather than read them, and the results body is blanked before the
> test ends so Playwright's failure snapshot cannot capture it. A unit test fails if any of that is
> undone. Debug failures locally against `dist/` with the mocked suite, where traces are safe.

GIS staff can reproduce the FEMA full-parcel selection in ArcGIS Pro, an ArcGIS Online Notebook, or
anywhere with ArcGIS API for Python installed:

```bash
python scripts/fema_highest_hazard.py 16264570030000
```

The JSON output includes the selected highest classification, every FEMA classification touching
the parcel, the corresponding Millcreek classifications and their congruence result. The selection
is a documented display precedence, not a FEMA risk score.

### Why each page is self-contained

Deliberate. The people who maintain production configuration are GIS staff, not JavaScript
developers. Each page keeps its own clearly marked configuration block and has no runtime
dependency tree. The licensing page is separate so its purpose, contacts, data snapshot and
maintenance cycle do not become entangled with the general property report.

There is a build step (Vite, [ADR-0001](docs/decisions/0001-use-vite-with-build-time-configuration.md)),
but still **no runtime dependencies** — the built pages ship as self-contained HTML with an inline
script. Developer-only packages run the test suite and are not shipped. The self-contained choice
means the Content Security Policy needs `'unsafe-inline'` for inline `<style>` and `<script>`; that
accepted tradeoff is documented in `public/_headers`.

### Configuration

Everything editable lives in the `CFG` object at the top of the `<script>`, above the line reading
`No further edits needed below this line.` See [USAGE.md](USAGE.md) for a field-by-field guide.

| To change | Edit |
|:--|:--|
| Phone, email, response-time promise | `CFG.contact` |
| Show/hide owner of record | `CFG.parcel.showOwner` |
| Add or remove a data layer | `CFG.LAYERS` |
| Hazard and designation source layers | `CFG.LAYERS` |
| Which parcel fields display | `CFG.PARCEL_FACTS` |
| Standing data-quality disclaimers | `CFG.GROUP_NOTES` |
| Address abbreviations and local street variants | `CFG.address.synonyms`, `.streetAliases` |

Two traps:

**Layer indices are rarely 0.** Council districts are layer **2**, water service **3**, and
subdivisions **7**. Always read `<service>/FeatureServer?f=json` before configuring.

**Check the layer actually has attributes.** `Sensitive_Land_Areas__Feb24` carries only `OBJECTID`
and geometry. For a layer like that set `boolean: true`, or no useful regulatory value can be
displayed.

### Repository layout

```text
index.html                 The general property lookup, self-contained. A Vite entry point.
business-licensing.html    The short-term-rental and 400-foot buffer lookup. Also an entry.
public/                    Static passthrough. Copied verbatim into dist/, never processed.
  assets/                    Municipal brand assets stored locally for reliable rendering.
  _headers                   Netlify response headers, including the CSP.
  staticwebapp.config.json   Azure response headers, routes and cache rules. Must agree
                             with _headers; a unit test compares them.
dist/                      Build output and the deployed artifact. Generated, git-ignored.
vite.config.mjs            MPA build configuration; both HTML files are entry points.
netlify.toml               Netlify build and redirect configuration.
scripts/                   Service-contract and deployment checks, and the FEMA parcel script.
tests/                     Unit, Python, browser and axe suites, plus the live smoke run.
docs/                      ADRs, hosting runbook, brand note, manual screen-reader script.
.github/workflows/         Quality checks, staging deploy, production promotion, verification.
```

> **The entry pages must not live in `public/`.** Vite copies `publicDir` verbatim without
> processing, so an entry left there would silently bypass the build — everything would appear to
> work while nothing was actually built.

### Deploying and releasing

**GitHub Actions is the publisher, and the two halves are deliberately separate.**

| Workflow | Trigger | Reaches production? |
|:--|:--|:--|
| `deploy-staging.yml` | every push to `main` | no — it cannot reach the production credential |
| `promote-production.yml` | by hand, with a staging run id | only after a required reviewer approves |

`promote-production.yml` builds and tests nothing. It republishes the exact artifact a named
staging run produced and gated, so the bytes a reviewer approves are the bytes residents load.
Promotion is a human act performed by a designated municipal approver — see
[ADR-0002](docs/decisions/0002-host-on-azure-static-web-apps.md) for why, and
[docs/azure-hosting.md](docs/azure-hosting.md) for the resources, cutover and rollback.

`verify-deployment.yml` produces the evidence an approval rests on: it compares the served bytes
against the artifact the commit builds, proves no repository file is published, asserts every
declared security header, and runs a real lookup on both pages against the live services. It holds
no deployment credential, by design.

What ships is an allowlist enforced by the build: only the entry pages, their assets, and
everything in `public/` reach `dist/`. Committing a document elsewhere does not put it on the
public site, and `npm run check:deployment` proves that against a running deployment.

**Response headers are declared twice, on purpose.** `public/_headers` is read by Netlify and
`public/staticwebapp.config.json` by Azure, and each host silently ignores the other's file. A unit
test compares them header by header and route by route, because otherwise a CSP edit would ship to
one host and not the other with nothing failing.

> **Hosting note, 2 September 2026.** Production moved to Azure Static Web Apps at
> `lookup.gis.millcreekut.gov`. The previous Netlify deployment is still serving in parallel as the
> rollback until the changeover settles, which is why both host configurations are still present and
> still tested. Netlify's production pages carried an injected marketing comment and two tracking
> meta tags that no setting could remove on that account; `scripts/deployment-content.mjs` tolerates
> that difference narrowly and reports it on every passing run. Azure serves the built bytes exactly,
> so on production the allowance is inert. It comes out with the rest of the Netlify configuration
> when that deployment is retired.

### Documentation

| File | What it covers |
|:--|:--|
| [USAGE.md](USAGE.md) | For residents, front-counter staff, and GIS staff maintaining the config |
| [CODE.md](CODE.md) | Full code walkthrough — every function explained |
| [DATA-SOURCES.md](DATA-SOURCES.md) | Data ownership, freshness and replacement-candidate register |
| [WEB-MAP-REVIEW.md](WEB-MAP-REVIEW.md) | Inventory and disposition review of the 96 public-map layers |
| [MIGRATION.md](MIGRATION.md) | ADR-0001 migration state, with what is verified and what is not |
| [RELEASE.md](RELEASE.md) | Release convention and checklist |
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [docs/azure-hosting.md](docs/azure-hosting.md) | Hosting resources, cutover and rollback |
| [docs/decisions/](docs/decisions/) | Architecture decision records |
| [docs/manual-screen-reader-test.md](docs/manual-screen-reader-test.md) | The runnable NVDA script |
