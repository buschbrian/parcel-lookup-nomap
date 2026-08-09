# Millcreek Property Lookup

An accessible, text-only property lookup for Millcreek, Utah. Enter an address or parcel number and
get zoning, future land use, subdivision, hazard, district and utility information as structured
text — **no map, no mouse, and no vision required.**

Live: <https://parcel-lookup-millcreek.netlify.app/>

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
seek from the map. The visual map remains available for people who prefer it.

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
- **Hazard and special designations** — FEMA flood, Wildland-Urban Interface, Sensitive Land Area,
  historic, each as an explicit Yes/No with a plain-language explanation of what it means
- **Zoning** — base zone, future land use / General Plan designation, City Center Overlay, historic
  district
- **Subdivision and plat** — plat name, plat number, and a link to the recorded plat PDF
- **Natural hazards** — FEMA flood zone detail, geologic fault study area
- **Representation** — City Council district and council member
- **Services** — culinary water provider, sewer district, electrical provider and waste collection day

Plus **copy as plain text**, **print**, and a staffed fallback with a published response time.

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
- Reflows to 320 px with no two-dimensional scrolling (1.4.10)
- Interactive targets ≥ 44 × 44 px (2.5.8)
- Visible focus indicator at 3 px, never removed (2.4.7)
- Respects `prefers-reduced-motion` and `prefers-color-scheme`
- No `<canvas>`, no `<iframe>`, no browser storage
- Automated unit, browser and axe checks cover structure, keyboard behavior, deterministic ArcGIS
  responses, result semantics, copying, contrast and common accessibility failures

**Not yet verified:** manual keyboard-only pass and NVDA pass. Automated testing catches roughly
25–40% of WCAG issues, so **no public conformance claim should be made until those are complete.**

If JavaScript is unavailable the lookup cannot run, but the staffed fallback — phone, email,
response-time commitment — is static HTML and still renders. The service degrades to a human, not
to a broken page.

---

## Repository layout

```
index.html      The entire application. One file by design — see below.
_headers        Netlify security headers, including the CSP.
netlify.toml    Netlify build/redirect configuration.
README.md       This file.
USAGE.md        For residents, front-counter staff, and GIS staff maintaining the config.
CODE.md         Full code walkthrough — every function explained.
DATA-SOURCES.md Data ownership, freshness and replacement-candidate register.
tests/          Developer-only deterministic unit, browser and accessibility tests.
scripts/        Live service-contract and deployment checks.
```

### Why one file

Deliberate. The people who maintain production configuration are GIS staff, not JavaScript
developers. A single file
with a clearly marked configuration block at the top means adding a layer or changing a phone
number is a text edit and a commit — no build step, no bundler, no dependency tree, nothing to
install, nothing to break in six months when a package deprecates.

The deployed app still has no runtime dependencies or build step. Developer-only packages run the
test suite and are not shipped. The single-file choice means the CSP needs `'unsafe-inline'` for the
inline `<style>` and `<script>`; that accepted tradeoff is documented in `_headers`.

---

## Quick start

No production build step and no runtime dependencies.

```bash
git clone <this repo>
cd parcel-lookup
python3 -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

To run developer checks, install the dev-only dependencies and tests:

```bash
npm ci
npx playwright install chromium
npm test
npm run check:services       # live public ArcGIS contract check
npm run check:deployment     # after Netlify has deployed the commit
```

> **Do not test by double-clicking `index.html`.** Over `file://` the browser blocks the
> cross-origin request to ArcGIS, so every lookup fails even though the service is fine. The app
> now detects this and says so on load, but you still need a local server to test lookups. Layout
> and print styles are fine to check over `file://`.

### Deploying

Static hosting. Currently Netlify, auto-deploying from `main`. `_headers` and `netlify.toml` are
picked up automatically.

Deploy this as its **own** site. Do not place it inside the Experience Builder site's publish
directory — an ExB Developer Edition publish replaces that whole directory and would silently
delete this app.

After Netlify reports a successful deploy, run `npm run check:deployment`. It compares the live
HTML byte-for-byte with the repository and verifies the security/cache headers. Use Netlify's prior
deploy rollback if either check fails.

---

## Configuration

Everything editable lives in the `CFG` object at the top of the `<script>`, above the line reading
`No further edits needed below this line.` See **USAGE.md** for a field-by-field guide.

Common edits:

| To change | Edit |
|:--|:--|
| Phone, email, response-time promise | `CFG.contact` |
| Show/hide owner of record | `CFG.parcel.showOwner` |
| Add or remove a data layer | `CFG.LAYERS` |
| Hazard flags and their explanations | `CFG.PARCEL_FLAGS` |
| Which parcel fields display | `CFG.PARCEL_FACTS` |
| Standing data-quality disclaimers | `CFG.GROUP_NOTES` |
| Address abbreviations and local street variants | `CFG.address.synonyms`, `.streetAliases` |

### Two traps

**Layer indices are rarely 0.** Council districts are layer **2**, water service **3**, and
subdivisions **7**. Always read `<service>/FeatureServer?f=json` before configuring.

**Check the layer actually has attributes.** `Sensitive_Land_Areas__Feb24` carries only `OBJECTID`
and geometry. For a layer like that set `boolean: true`, or no useful regulatory value can be
displayed.

---

## Data sources

All queries go to Millcreek's ArcGIS Online feature services at
`services9.arcgis.com/XRrSFvEwSsReIxuA`. The CSP restricts `connect-src` to that origin only — if
you add a layer from another host you must add that origin to `_headers` or every query will fail
silently in the console.

| Data | Origin |
|:--|:--|
| Parcels, ownership, valuation | Salt Lake County Recorder and Assessor |
| Addresses | Utah Geospatial Resource Center (UGRC), Salt Lake County |
| Zoning, overlays, future land use, subdivisions | Millcreek |
| Flood hazard | FEMA |
| Fault study areas | Utah Geological Survey |
| Utility service areas | Utah Division of Drinking Water, UGRC, providers |

### On data quality

Utility and hazard boundaries are third-party regulatory products. They contain gaps, overlaps and
other topological defects, and they are not always current when a provider's service area changes.
The application derives them from a **single point inside the parcel**, so a property can be partly
within an area that this reports as "No."

Standing disclaimers to that effect are shown with every Services and Natural hazards result. They
are in `CFG.GROUP_NOTES` and should not be removed. This tool is a starting point, not proof of
service, and not a flood determination for lending or insurance.

Every configured service, field and ownership contact is recorded in
[DATA-SOURCES.md](DATA-SOURCES.md). Older-named zoning, future-land-use and WUI sources must not be
changed merely because a newer-looking ArcGIS item exists; GIS/Planning approval and result
comparison are required first.

---

## Known limitations

1. **Centroid-based determination.** All non-parcel layers are tested against the parcel centroid,
   not the parcel boundary. A parcel can be partly inside an area while its centroid is outside.
   The exception is Sensitive Land Areas, where the parcel record's precomputed field is used
   instead and the centroid test runs only as a cross-check that surfaces disagreement.
2. **The currently linked recorded plat PDFs are scanned drawings** and are not screen-reader
   accessible. The app identifies that limitation and offers staff to read or describe the needed
   dimensions and easements.
3. **Sensitive Land Areas has no attributes**, so the app can report *that* a property is in one but
   not *which* constraint applies. This affects 62.4% of parcels and is the highest-priority data
   gap.
4. **66 parcels have no address** and are reachable only by parcel number.
5. **Requires JavaScript.** Degrades to the staffed fallback.

---

## Accessibility problems and feedback

Report anything that prevents you getting the information you need:

- Phone **801-214-2754**
- Email **gis@millcreekut.gov**
- Commitment: an accessible format **within 5 business days**

Bugs and enhancements: open an issue in this repository.

---

## Disclaimer

This tool reports the data of record. It is **not** a zoning verification letter, **not** a flood
determination for lending or insurance purposes, and **not** a determination that a property can be
developed. For a binding determination contact Planning and Development Services at 801-214-2754.

Full disclaimer of warranty and liability is published in the application footer and follows
Millcreek's adopted data disclaimer.
