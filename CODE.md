# Code Walkthrough

`index.html` is the complete general property lookup. `business-licensing.html` is a separate,
self-contained short-term-rental buffer lookup. Each contains its own semantic HTML, CSS,
configuration and plain JavaScript. Neither has runtime packages, build output or a map library.

This guide describes responsibilities and invariants instead of line numbers so it remains useful
as the file changes.

---

## 1. Design constraints

1. **WCAG 2.1 Level AA is the target.** Automated checks support that work but are not a public
   conformance claim; keyboard and screen-reader testing remain required.
2. **Each production page stays self-contained.** GIS staff can change its marked `CFG` block
   without a bundler.
3. **Third-party values are untrusted.** Rendering uses `textContent`; only validated HTTP(S) URLs
   and dialable North American phone numbers become links.
4. **Missing data is not a negative answer.** A missing FEMA classification is Unknown. Service
   failures and unexpected overlaps remain visible.
5. **A partial answer is better than a blank page.** Independent layer failures are contained and
   reported while successful results render normally.

The self-contained-page choice requires `'unsafe-inline'` in the CSP. `public/_headers` records that accepted
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

### Two CSS rules that look cosmetic and are not (added 13 August 2026)

```css
body{overflow-wrap:break-word}
dt,dd,li{overflow-wrap:anywhere}
```

Without these, enlarged text forced horizontal scrolling — at a 320 px container, 200% text produced
358 px of content, failing 1.4.10 and 1.4.4. The offenders are data rather than prose: 14-digit
parcel numbers and email addresses have no break opportunity.

`anywhere` on the list children is load-bearing. Only `anywhere` reduces the **min-content
contribution** that CSS Grid uses to size the label column; `break-word` alone leaves the track too
wide and the overflow survives. Do not collapse one into the other.

```css
#main:focus,#r-head:focus{outline:3px solid var(--focus);outline-offset:4px}
```

Script moves focus to `#r-head` after every lookup and to `#main` via the skip link. `:focus` is
cleared globally in favour of `:focus-visible`, but **`:focus-visible` does not match programmatic
focus on a non-interactive `tabindex="-1"` element** — so without this rule those two targets get no
indicator at all, and a sighted keyboard user has focus relocated with nothing on screen to show it.
This deliberately uses `:focus`, because the focus is always programmatic.

Both rules are covered by regression tests. Note that a computed-style assertion cannot verify the
focus rule: `outlineStyle` reads `none` whenever the window lacks OS focus, and `outlineWidth` reads
the UA default `medium` even when no rule exists. The tests therefore check behaviour and CSSOM
declaration separately.

---

## 3. Configuration (`CFG`)

Everything above the `No further edits needed below this line` marker is the maintenance surface.

| Section | Responsibility |
|:--|:--|
| `release` | Static version, publication date and data-review date |
| `referenceWebMap` | Public Planning web-map item used for source-parity checks |
| `request` | Fetch timeout, one-retry delay, suggestion debounce delay and the concurrent-request cap |
| `address` | Address service, field names, synonyms and safe local aliases |
| `parcel` | Parcel service, identifier, centroid fields, owner/care-of/Assessor-link field names and owner visibility |
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

Every parcel field the page displays is named in `CFG`, including `ownerField`, `careOfField` and
`assessorLinkField`. That is not decoration: `npm run check:services` verifies exactly what `CFG`
declares, so a field read by name in the rendering code is a field no check can notice disappearing.
When the County renames one, the result is not an error — the owner block or the valuation link
simply stops appearing, in every result, silently. Name a field in `CFG` before displaying it.

Layer indices are service-specific and are not assumed to be zero. `DATA-SOURCES.md` is the review
register; a newer-looking ArcGIS item is not adopted without data-owner approval and comparison.

The licensing page has a deliberately smaller `CFG`: address points, parcels, published STR
parcels and published STR buffers. It does not import zoning, hazards, utilities or owner-record
output from the general page. Its spatial buffer query removes a feature when that feature's source
`parcel_id` equals the selected parcel before answering “within 400 feet of another published
STR.”

The parcel's denormalized hazard/designation flags are deliberately not displayed. Boolean source
layers use a successful spatial query as Yes/No; a failed query renders Unavailable. FEMA is
specialized: no returned classification renders Unknown rather than No.

---

## 4. DOM and request helpers

Both pages carry the request layer — `svcError`, `RUNNING_FROM_FILE`, `fetchJson`, `withRetry`,
`acquireSlot`, `releaseSlot`, `pump`, `layerUrl`, `rawQuery`, `query` and `explain` — between
`==== SHARED REQUEST LAYER ====` markers, and a unit test compares the two copies **byte for byte**.
Do not reformat that block or specialise it for one page. It reads `org`, `request.timeoutMs`,
`request.retryDelayMs`, `request.maxConcurrent` and `contact.phone` from whichever `CFG` it is embedded in, so the licensing
page offers Business Licensing's number and the general page offers GIS's.

Holding two copies identical looks like the opposite of removing duplication, and it is deliberate.
Divergence is what produced the defects: one page retried rejected queries and permanent HTTP errors,
one sent superseded requests to the network, and the two reported failures in different vocabularies.
ADR-0001 replaces both inline scripts with shared modules, and identical copies extract mechanically
while divergent ones force an undocumented merge decision per difference. Converging them is a step
toward that extraction, not a substitute for it. `el()`, `flagPair` and the address parser are the
next candidates.

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

Two escaping helpers, and they are not interchangeable. `esc()` doubles single quotes and is for
equality operands. `likeOperand()` also escapes `%` and `_`, and every `LIKE` built with it carries
`ESCAPE '\'`. Without that, a typed wildcard silently changes the search rather than being looked
for: `330_ E` matches every house number from 3300 to 3309 and reports the result as if the resident
had asked for it. Escaping wildcards in an equality operand would be the opposite mistake, inserting
backslashes into a literal value, which is why the two are separate.

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

A tier can match more addresses than the service will return. `resultRecordCount` caps the result at
`address.max` and ArcGIS reports the cap in `exceededTransferLimit`; a street such as Santa Rosa has
49 matching points. The cap is read from that flag rather than inferred from the row count, because
address points without a parcel ID are discarded after the response arrives. When the list is
partial the live region says so and names what to add to narrow it, because announcing a bare count
would present ten of forty-nine as the complete answer and silently strand a resident whose address
is not among them. Submitting free text does not auto-load a lone surviving row when the service
reported a cap: one row out of a truncated result is not a unique match.

Input events invalidate older requests immediately and debounce suggestions for
`request.suggestDebounceMs`. That delay is configuration rather than a literal so cancellation races
can be tested deterministically instead of depending on how fast a test run happens to be. A
sequence ticket and abort signal both protect against stale output. The listbox implements Down, Up, Home,
End, Escape and Enter while DOM focus remains in the input. Moving focus out of the combobox closes
the list, including when the user presses Tab.

Both pages follow one rule about which code claims a ticket. **The event that starts a user action
claims it; work that the action merely schedules never does.** The input event therefore clears the
stored selection and takes the ticket itself, and the debounced search inherits that ticket rather
than opening its own. A search that ticketed itself when its timer fired would abort whatever the
user did during the debounce window — and because the abort is classified as cancellation, it is
discarded silently, leaving the page mid-progress with no error. Anything that supersedes a queued
suggestion — choosing an option, submitting, clearing, dismissing — cancels the pending timer.
Choosing with a pointer happens to survive without that step, because emptying the listbox detaches
the clicked option and the document-level handler then treats the click as falling outside the
combobox; choosing with Enter fires no click and has no such accident to rely on. `activeKind`
records what the live ticket belongs to, so dismissing suggestions can invalidate a pending search
without disturbing a lookup.

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
A hidden query compares those classifications with the public-map flood copy, normalizes its
`PERCENT`/`PCT` label difference, ignores the local layer's documented minimal-X omission, and
makes every other mismatch visible. Surface fault rupture is an explicit Yes/No full-parcel query
against the public map's special-study-area polygon. Historic fields preserve the distinction
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
verifies configured endpoints and fields, a known address, FEMA/local flood congruence, the two
historic designation types, and parity between adopted local sources and the public Planning web
map. CI runs it on a schedule or manual dispatch, not as a pull-request dependency.

`npm run check:deployment` is a post-deploy gate. It requires the live HTML of both pages to match
the built `dist/` artifact — tolerating only the host transformations declared in
`scripts/deployment-content.mjs` — checks CSP, permissions, referrer, HSTS, MIME-sniffing and cache
headers, and probes repository paths to confirm the publish directory is not exposing them. It
refuses to run without `dist/`, because comparing against source would prove nothing about what
Netlify actually publishes. Every header it asserts is declared in `public/_headers`, so a failure
points at something in this repository rather than at a hosting default. It asserts HSTS directives,
not merely the presence of `max-age`, because a shortened window or a dropped `includeSubDomains` is
a downgrade worth failing on.

> **This check was red from 13 to 26 August 2026, and until then the byte comparison had never gated
> anything.** Netlify's Pretty URLs post-processing rewrote links in the deployed HTML, so the live
> bytes matched no commit in the repository; the check asserted exact bytes and aborted on the first
> failure, never reaching the header or allowlist gates. It was first run with network access on
> 13 August 2026 and failed immediately.
>
> **There were two rewrite forms, and both had to be handled by any normalising repair:**
>
> | Page | Repository | Live |
> |:--|:--|:--|
> | `index.html` | `href="/business-licensing.html"` | `href='/business-licensing'` |
> | `business-licensing.html` | `href="/index.html"` | `href='/'` |
>
> The second is not extension-stripping but `/index.html` collapsing to the directory root, so a repair
> that only stripped `.html` would have made the property page pass while the licensing page kept
> failing. Apart from these, the live property page was byte-equal to its source — there was no other
> drift.
>
> While it was red, everything after that first assertion was verified by hand instead and passed —
> all six headers on both pages, and every repository-path probe confirmed unpublished. Note that
> `/netlify.toml` returns Netlify's own 404 page rather than the app, because Netlify reserves that
> path, so that probe accepts a 404.
>
> **Repaired 26–27 August 2026.** Of the two repairs on the table, the second was taken: Pretty URLs
> is turned off in `netlify.toml`, as docs/changes/CHANGES-2026-08-13.md §7 recommended, and the explicit redirect
> already routes `/business-licensing`. The check no longer aborts on the first failure — every gate
> runs and all findings are reported together — and it compares against the built `dist/` artifact.

Automated checks do not replace the manual keyboard, reflow, zoom, forced-colors, print and NVDA
matrix documented in `USAGE.md`.
