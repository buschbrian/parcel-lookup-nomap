# Millcreek Property Lookup

An accessible, text-only property lookup for Millcreek, Utah. Enter an address or parcel number and
get zoning, future land use, subdivision, hazard, district and utility information as structured
text — **no map, no mouse, and no vision required.**

Live: <https://parcel-lookup-millcreek.netlify.app/>

---

## Why this exists

Millcreek is a public entity subject to **ADA Title II, 28 CFR Part 35 Subpart H**, which requires
web content to conform to **WCAG 2.1 Level AA**. For entities with a 2020 census population of
50,000 or more, the compliance date was **24 April 2026**.

Interactive maps are the hardest part of that obligation. Full WCAG conformance for a complex map
interface is not achievable with current tooling — a map is a canvas element, and a canvas conveys
nothing to a screen reader. A measurement of the City's production zoning application found:

| Check | Result |
|:--|:--|
| Headings | 0 |
| Landmarks | 0 |
| Buttons with no accessible name | 241 of 666 |
| Search input programmatically labelled | No |
| Status regions (`aria-live`) | 0 |
| Map `<canvas>` accessible name | none |

The correct response is not "make the map accessible." It is the framing US DOJ guidance and
accessibility practice both point to:

> **What service is this map delivering, and how else can we deliver that service?**

This application is that other way. The map remains available for people who prefer it. Neither is
a lesser version of the other.

It also serves a second purpose. Where a map genuinely cannot conform, §35.164 permits a written
undue burden determination **only if alternative access is still provided**. This app is that
alternative access, which is what makes the determination defensible.

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
- **Services** — culinary water provider, sewer district, electrical provider, waste collection day,
  firework restrictions

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
- **Verified:** 20 automated structural checks and 11 computed contrast ratios pass; lowest text
  pair 7.68:1 against a 4.5:1 requirement

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
```

### Why one file

Deliberate. The people who maintain this are GIS staff, not JavaScript developers. A single file
with a clearly marked configuration block at the top means adding a layer or changing a phone
number is a text edit and a commit — no build step, no bundler, no dependency tree, nothing to
install, nothing to break in six months when a package deprecates.

The cost is that the CSP needs `'unsafe-inline'` for the inline `<style>` and `<script>`. That
tradeoff is documented in `_headers`. If the constraint is ever lifted, split the CSS and JS into
files and remove both `'unsafe-inline'` values.

---

## Quick start

No build step and no dependencies.

```bash
git clone <this repo>
cd parcel-lookup
python3 -m http.server 8080     # or: npx serve .
# open http://localhost:8080
```

Opening `index.html` directly via `file://` also works for layout, but some browsers restrict
`fetch` from `file://` origins, so use a local server to test lookups.

### Deploying

Static hosting. Currently Netlify, auto-deploying from `main`. `_headers` and `netlify.toml` are
picked up automatically.

Deploy this as its **own** site. Do not place it inside the Experience Builder site's publish
directory — an ExB Developer Edition publish replaces that whole directory and would silently
delete this app.

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

**Layer indices are rarely 0.** Council districts are layer **2**, water service **3**, fireworks
**5**, subdivisions **7**. Always read `<service>/FeatureServer?f=json` before configuring.

**Check the layer actually has attributes.** `Sensitive_Land_Areas__Feb24`, `Zone_FCOZ` and
`Zone_RCOZ` carry only `OBJECTID` and geometry. For those set `boolean: true`, or the row renders
blank where a regulatory answer belongs.

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

---

## Known limitations

1. **Centroid-based determination.** All non-parcel layers are tested against the parcel centroid,
   not the parcel boundary. A parcel can be partly inside an area while its centroid is outside.
   The exception is Sensitive Land Areas, where the parcel record's precomputed field is used
   instead and the centroid test runs only as a cross-check that surfaces disagreement.
2. **Recorded plat PDFs are scanned drawings** and cannot be made accessible. The app links them,
   says so plainly, and offers staff to read the dimensions and easements aloud.
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
