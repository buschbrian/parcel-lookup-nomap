# Code Walkthrough

`index.html` is the complete production application: semantic HTML, CSS, configuration and plain
JavaScript. It has no runtime packages, build output or map library. Developer-only tests live
outside that file and never ship to Netlify.

This guide describes responsibilities and invariants instead of line numbers so it remains useful
as the file changes.

---

## 1. Design constraints

1. **WCAG 2.1 Level AA is the target.** Automated checks support that work but are not a public
   conformance claim; keyboard and screen-reader testing remain required.
2. **Production stays one file.** GIS staff can change the marked `CFG` block without a bundler.
3. **Third-party values are untrusted.** Rendering uses `textContent`; only validated HTTP(S) URLs
   and dialable North American phone numbers become links.
4. **Missing data is not a negative answer.** A missing FEMA classification is Unknown. Service
   failures and unexpected overlaps remain visible.
5. **A partial answer is better than a blank page.** Independent layer failures are contained and
   reported while successful results render normally.

The single-file choice requires `'unsafe-inline'` in the CSP. `_headers` records that accepted
tradeoff. If production is ever split into external CSS and JavaScript, remove both allowances.

---

## 2. Document structure and CSS

The body contains a banner, one main landmark and a footer. Main contains:

- an ARIA 1.2 address combobox;
- a polite status region;
- a hidden-until-ready results section;
- a static staffed fallback that remains available without JavaScript.

Results use headings and description lists. `dt` and `dd` preserve each label/value relationship.
The visual map is an optional link, not a prerequisite for the lookup.

CSS custom properties define light and dark palettes. Focus uses a three-pixel visible indicator.
Status is never colour-only: flags combine a glyph, a word and colour. `Yes`, `No` and `Unknown`
each have a distinct spoken word. Cards reflow to one column on narrow screens, controls meet the
44-pixel target, reduced-motion preferences are respected, and print keeps results and disclaimers
while hiding the form and buttons.

`.callout` is reserved for property-specific warnings or explanations. `.note` is quieter and
holds standing source limitations. Keeping those styles distinct prevents permanent caveats from
making actual warnings easy to ignore.

---

## 3. Configuration (`CFG`)

Everything above the `No further edits needed below this line` marker is the maintenance surface.

| Section | Responsibility |
|:--|:--|
| `release` | Static version, publication date and data-review date |
| `request` | Fetch timeout and one-retry delay |
| `address` | Address service, field names, synonyms and safe local aliases |
| `parcel` | Parcel service, identifier, centroid fields and owner visibility |
| `contact` | Phone, email and staffed response commitment |
| `planning` | Planning & Zoning contact for binding determinations |
| `LAYERS` | Local or absolute ArcGIS sources, spatial method and display rules |
| `PARCEL_FACTS` | Ordered parcel-record facts and field-specific formatting |
| `GROUP_NOTES` | Standing limitations for third-party result groups |

Every displayed layer carries:

- `sourceOwner` and `reviewedOn` for governance;
- `cardinality`, normally `"one"`, so an unexpected overlap becomes a warning;
- an explicit `fields` map for resident-facing output;
- optional `boolean`, `note`, `geometryMode`, `kind`, distance, link or attachment settings.

Layer indices are service-specific and are not assumed to be zero. `DATA-SOURCES.md` is the review
register; a newer-looking ArcGIS item is not adopted without data-owner approval and comparison.

The parcel's denormalized hazard/designation flags are deliberately not displayed. Boolean source
layers use a successful spatial query as Yes/No; a failed query renders Unavailable. FEMA is
specialized: no returned classification renders Unknown rather than No.

---

## 4. DOM and request helpers

`el(tag, attributes, children)` is the only general element builder. Attribute values and text are
assigned without `innerHTML`.

`say(message, tone)` updates the live status region and its visual error tone.

`startTask(kind)` increments the sequence ticket, aborts the prior controller and returns the new
ticket and signal. Every input edit, search, lookup and Clear action starts or invalidates a task.
This prevents a slow response from reopening cleared suggestions or repopulating cleared results.

`fetchJson(url, signal)` provides the common network contract:

- a bounded timeout from `CFG.request.timeoutMs`;
- propagation of user/task cancellation;
- HTTP, rate-limit, server, malformed-JSON and ArcGIS error-body classification;
- the failing URL in diagnostic detail.

`withRetry()` retries network, timeout, HTTP 429 and server failures once. It never retries rejected
queries, ordinary HTTP errors or cancelled work. `explain()` turns the classification into public
language and always includes the staffed route where appropriate.

`layerUrl()` supports both Millcreek-relative and authoritative absolute service URLs. `query()`
builds ArcGIS `/query` URLs. `schema()` reads aliases and coded-value domains through the same
classified helper and caches only successful metadata. A schema failure does not erase feature
values; it marks the layer as degraded and leaves codes undecoded.

`decode()` expands coded domains, trims strings and treats whitespace-only values as absent. It does
not treat numeric zero as missing.

---

## 5. Address parsing and combobox

`parseAddress()` uppercases and normalizes the resident's input:

- spelled directions and street types become stored abbreviations;
- punctuation and a trailing city/state/ZIP are removed;
- `APT`, `UNIT`, `STE`, `LOT` and `#3` forms are removed from the search address;
- verified local aliases such as `MILL CREEK` become the stored street spelling;
- house number and street name are extracted without losing the full normalized address.

Configured aliases are regular-expression escaped before use. An alias must never collapse two
real, distinct street names.

`findAddresses()` tries the documented tiers in order and stops at the first tier with results:

1. normalized `FullAdd` prefix;
2. house number plus street name;
3. street name without a house number;
4. a broad contains search.

The returned note tells the live region whenever matching was broadened.

Input events invalidate older requests immediately and debounce suggestions for 250 ms. A sequence
ticket and abort signal both protect against stale output. The listbox implements Down, Up, Home,
End, Escape and Enter while DOM focus remains in the input. Moving focus out of the combobox closes
the list, including when the user presses Tab.

Selecting an option stores its parcel ID and starts a lookup. Submitting free text uses the same
tiered search; multiple candidates are shown rather than guessed. A 9–14 digit parcel entry is
left-padded to the stored 14-digit form.

---

## 6. Loading and rendering a property

`load(parcelId, label)` fetches the parcel record and schema together. It requires the parcel
record and geometry but treats individual overlay services independently. If centroid coordinates
are present, `hits()` runs all configured spatial queries in parallel. Layers marked
`geometryMode: "parcel"` receive the full boundary; others receive the stored point. A layer can
also define an ArcGIS search distance and units.

For each layer, `hits()`:

1. settles feature and schema requests separately;
2. keeps raw feature values when only schema metadata fails;
3. records all matches and warns when a singular layer returns more than one;
4. retrieves configured attachments through the same timeout/retry helper;
5. distinguishes no attachment from an attachment-listing failure;
6. returns a visible failed-layer record for non-cancellation errors.

`draw()` emits cards in this order:

1. **Property record** — formatted facts, owners and a validated Assessor link.
2. **Configured groups** — explicit values, booleans, attachments, overlap/schema warnings and
   standing data notes.
3. **Location** — centroid coordinates and an optional visual-map link.

FEMA's specialized renderer shows SFHA status, the selected highest zone/subtype and all
intersecting classifications. Its conservative precedence is not presented as a FEMA risk score.
The UGS renderer shows a 1,000-foot direct fault-trace screen and explicitly disclaims any local
special-study-area or site-specific determination. Historic fields preserve the distinction
between National Register and local-ordinance designations.

Every configured row is labelled `<Layer label> — <Field label>` so repeated labels such as
"Phone" remain self-describing outside their visual context. URLs use the provider name where
available. Phone links are created only for ten digits or eleven digits beginning with 1.

Recorded-plat links include the plat name, format and size. The adjacent note describes the current
scanned files as not screen-reader accessible and gives the staffed description route. An attachment
failure is visible instead of looking like the parcel has no plat.

After rendering, the live region summarizes degraded sources and focus moves to the results heading.

---

## 7. Copy, print and release information

Copy walks the rendered cards and includes:

- every label/value pair and HTTP(S) destination;
- callouts, source notes and non-duplicated metadata;
- the public disclaimer;
- the static release and data-review dates plus the actual copy timestamp.

If Clipboard API access fails, the previous fallback is removed and a labelled, preselected
textarea is inserted. Print uses the same visible result DOM and includes the footer disclaimer.

The footer release label comes from `CFG.release`. It never uses the visitor's date as a fake build
date.

---

## 8. Verification and operations

`npm test` runs JavaScript and Python pure-function checks plus deterministic Playwright/axe browser
tests with mocked ArcGIS responses. Those tests cover parser forms, FEMA ordering, historic
designation wording, zeroes, cancellation races, pointer/keyboard combobox selection, attachments,
overlap warnings, copied output and automated accessibility rules.

`npm run check:services` is intentionally separate because it calls public production services. It
verifies configured endpoints and fields plus a known address. CI runs it on a schedule or manual
dispatch, not as a pull-request dependency.

`npm run check:deployment` is a post-deploy gate. It requires the live HTML to equal the committed
`index.html` and checks CSP, permissions, referrer, HSTS, MIME-sniffing and cache headers.

Automated checks do not replace the manual keyboard, reflow, zoom, forced-colors, print and NVDA
matrix documented in `USAGE.md`.
