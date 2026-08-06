# Code Walkthrough

Every function in `index.html`, what it does, and why it is written that way. Line numbers are
approximate and will drift; the section names are stable.

**Contents**

1. [Design constraints](#1-design-constraints)
2. [Document structure](#2-document-structure-lines-1345)
3. [CSS](#3-css-lines-9200)
4. [The CFG block](#4-the-cfg-block-lines-348567)
5. [Helpers](#5-helpers-lines-569628)
6. [Address parsing and search](#6-address-parsing-and-search-lines-630704)
7. [The combobox](#7-the-combobox-lines-706813)
8. [Submit handling](#8-submit-handling-lines-815847)
9. [Loading a property](#9-loading-a-property-lines-849906)
10. [Rendering](#10-rendering-lines-9081128)
11. [Copy and print](#11-copy-and-print-lines-1129)
12. [Data flow summary](#12-data-flow-summary)
13. [Why certain things look odd](#13-why-certain-things-look-odd)

---

## 1. Design constraints

Four constraints drove every decision. Understanding them explains most of the code.

1. **WCAG 2.1 AA conformance is the point.** Not a nice-to-have. Anywhere a shortcut would cost
   conformance, the longer route was taken.
2. **Maintainers are GIS staff, not JS developers.** One file, no build step, no dependencies, a
   configuration block at the top, and logic below a marked line that nobody should need to touch.
3. **No map, and no pretending.** No canvas, no iframe, no map library. Where data cannot be made
   accessible (scanned plats), say so and offer a human.
4. **Never fail silently.** A missing hazard determination is worse than an error message. Every
   failure path produces text and a phone number.

---

## 2. Document structure (lines 13–345)

Plain semantic HTML, in this order:

```html
<a class="skip">              Skip to main content (2.4.1)
<header role="banner">        Site identity, <h1>
<main id="main" tabindex="-1">
  <p class="lede">            What this is, in plain language
  <form id="lookup">
    <fieldset><legend>        Groups the search controls
    <label for="q">           Explicit label (1.3.1, 3.3.2)
    <p class="hint" id="q-hint">   Referenced by aria-describedby
    <div class="combo">
      <input role="combobox"> ARIA 1.2 combobox
      <ul role="listbox">     Suggestions
  <div id="status" role="status" aria-live="polite">   4.1.3
  <section id="results" aria-labelledby="r-head">
    <h2 id="r-head" tabindex="-1">   Focus target after a lookup
  <h2>Prefer to ask a person?</h2>   STATIC — survives JS failure
<footer>
  <h2>Data sources and disclaimer</h2>
  <details><summary>          Full legal text, keyboard accessible
  <h2>Accessibility</h2>      Statement, contact, response time
```

Points that matter:

- **`tabindex="-1"` on `<main>` and on the results `<h2>`** makes them programmatic focus targets
  without adding them to the tab order.
- **The "Prefer to ask a person?" block is static HTML.** If the script fails, the phone number and
  response commitment still render. The service degrades to a human, not a broken page.
- **`<details>`/`<summary>`** gives a keyboard-accessible disclosure with no JavaScript.
- **No images.** Nothing needs alt text, so nothing can lack it.

---

## 3. CSS (lines 9–200)

### Custom properties and colour

Two palettes — light, and a `prefers-color-scheme: dark` override. Every colour was chosen against a
computed contrast ratio, not by eye. Lowest text pair is 7.68:1 against a 4.5:1 requirement; borders
4.19–4.54:1 against 3:1.

`--note-ink` exists separately from `--ink-soft` so the standing disclaimer can sit on `--surface`
and still clear 4.5:1.

### Focus (2.4.7)

```css
:focus{outline:none}
:focus-visible{outline:3px solid var(--focus); outline-offset:2px}
```

`:focus` is cleared **only** because `:focus-visible` immediately replaces it. Never remove one
without the other. `--focus` is a warm red at 6.54:1 against white — deliberately not a brand colour,
because focus must be unmistakable.

### Colour never alone (1.4.1)

```css
.flag[data-v=yes]{color:var(--yes)}
.flag[data-v=no] {color:var(--no)}
```

The colour is the *third* signal. `flagPair()` also emits a glyph (`●`/`○`, `aria-hidden`) and the
literal word "Yes"/"No". Remove the colour entirely and nothing is lost.

### `.callout` vs `.note`

- **`.callout`** — amber, property-specific warning. "You are in a flood zone, here's what that
  means."
- **`.note`** — grey, standing data-quality disclaimer, shown every time.

Separated deliberately: a permanent caveat rendered in warning colours trains people to ignore
warning colours.

### Reflow (1.4.10) and targets (2.5.8)

`max-width: 52rem`, single column, and a grid that collapses to one column below 34rem. Interactive
elements are `min-height: 2.9rem` ≈ 46px.

### Print

Hides the form and buttons; **keeps the footer and force-opens `<details>`** so a printed
determination always carries its disclaimer. External link URLs are appended via `::after`.

---

## 4. The CFG block (lines 348–567)

The only part intended for editing. See **USAGE.md** for the editing guide; this covers structure.

| Key | Purpose |
|:--|:--|
| `org` | Base URL for all feature services |
| `address` | Address point service, field names, and the normalisation tables |
| `parcel` | Parcel service, ID and centroid field names, `showOwner` |
| `contact` | Phone, email, response commitment — single source of truth |
| `LAYERS` | Every point-in-polygon lookup |
| `PARCEL_FLAGS` | Hazard flags read from precomputed parcel fields |
| `PARCEL_FACTS` | Which parcel attributes display, in order |
| `GROUP_NOTES` | Standing disclaimers per results group |
| `JUNK` | Regex of field names never shown from unconfigured layers |

`PARCEL_FACTS` entries are `[field, label, optionalFormatter]`. A formatter returning `null`
suppresses the row — that is how `year_built: 0` is hidden.

---

## 5. Helpers (lines 569–628)

### `el(tag, attrs, children)`

Tiny DOM builder. Exists so everything is created with `textContent`, never `innerHTML` — no HTML
injection path from service data, which is important because the app renders third-party attribute
values.

### `say(msg, tone)`

Writes to the `role="status" aria-live="polite"` region. **Every asynchronous outcome goes through
here** — that is 4.1.3 Status Messages. `tone="error"` switches styling; `:empty` hides the box.

### `rawQuery` / `query` / `explain` — classified errors

All feature service calls. Always `f=json` and `returnGeometry=false` — the app never needs
geometry, which keeps responses small and makes it obvious no map is coming.

Errors are **classified**, not collapsed into one message. `svcError(kind, msg, detail)` tags each
failure with a `kind`, and `explain(err, what)` turns that into a sentence worth reading:

| `kind` | Cause | Retried? |
|:--|:--|:--:|
| `file` | Page opened over `file://`; the browser blocks cross-origin fetch | no |
| `network` | Offline, DNS failure, CORS or CSP block | yes |
| `busy` | HTTP 429 rate limiting | yes |
| `server` | HTTP 5xx, or a malformed JSON body | yes |
| `http` | Any other non-OK status | no |
| `query` | ArcGIS rejected the SQL — **HTTP 200 with an `{"error":…}` body** | no |

`query()` wraps `rawQuery()` and retries once after 700 ms for the plausibly transient kinds. Rapid
typing against a public ArcGIS service can hit a momentary limit; one retry absorbs it.

> **Why this exists.** The original single message — "Could not reach the address service" — was
> reported for *any* thrown error. It appeared most often when someone opened the file directly from
> disk, where the service is perfectly healthy and the browser is the thing refusing. Telling a user
> the service is down when it is running wastes their time and hides the real fault. `RUNNING_FROM_FILE`
> is checked at startup so that case is announced immediately rather than after a failed search.

`console.error("[lookup] …")` carries the kind, message and failing URL for debugging.

### `schema(path)`

Fetches and **caches** a layer's field aliases and coded-value domains, storing the promise (not the
result) so concurrent callers share one request. This is what lets a layer be added with only a URL.

### `decode(field, value)`

Three jobs:

1. Resolve coded-value domains — `property_type_code: "111"` → `"Single Family Res"`.
2. Treat whitespace-only strings as empty. Assessor data contains `"    "`, which would otherwise
   print an empty row.
3. Trim strings.

Returns `null` for anything empty so callers use one check.

---

## 6. Address parsing and search (lines 630–704)

The most important code in the file, because it is where the app was failing residents.

### The problem

The County stores `FullAdd` as `AddNum + PrefixDir + StreetName + StreetType + SuffixDir`:

| Stored | Components |
|:--|:--|
| `3300 E SANTA ROSA AVE` | 3300 · E · SANTA ROSA · AVE · — |
| `2760 S 2100 E` | 2760 · S · 2100 · — · E |

Residents type `3300 East Santa Rosa Avenue`. A prefix `LIKE` on `FullAdd` finds nothing.

### `parseAddress(raw)`

```
uppercase
  → drop everything after the first comma      ", Millcreek, UT 84109"
  → strip unit tokens                          "APT 4", "#3", "STE 200"
  → strip punctuation, collapse whitespace
  → map each token through synonyms            EAST→E, AVENUE→AVE
  → apply streetAliases                        "MILL CREEK"→"MILLCREEK"
  → capture `normalized`  ← BEFORE consuming the number
  → shift off a leading house number           → num
  → drop a leading directional                 → prefix
  → drop a trailing directional                → suffix
  → drop a trailing street type                → type
  → what remains is `street`
```

Returns `{num, street, normalized}`.

> **A bug lived here.** `toks.shift()` mutates the array, so capturing `normalized` *after* taking
> the house number produced `"E SANTA ROSA AVE"` with no number. Tier 1 could never match and tier 2
> silently covered for it. `normalized` is now captured first. If you refactor this function, keep
> that ordering.

Order matters in the trailing drops: **suffix directional before street type.** `2760 S 2100 E` ends
in a directional, not a type.

### `findAddresses(raw, limit)`

Runs tiers in order and returns the first that finds anything, plus a `note` describing any
broadening.

| Tier | Query | Catches |
|:--|:--|:--|
| 1 exact | `FullAdd LIKE 'normalized%'` | Correctly-formed input, including normalised variants |
| 2 num + street | `AddNum='n' AND StreetName LIKE 'street%'` | Wrong or missing direction / street type |
| 3 street only | `StreetName LIKE 'street%'` | No house number typed |
| 4 broad | `FullAdd LIKE '%street%'` | Street name buried mid-string |

Tiers 2–4 **deliberately ignore direction and street type** — the parts people get wrong are exactly
the parts we can afford to discard, because `AddNum` + `StreetName` is already highly selective.

After the fix, every tested real-world variant resolves on **tier 1**, so the common case is a single
round trip.

**The `note` is announced.** Silently returning something other than what was typed is its own
accessibility failure, so the live region says "No exact match, so the search was broadened."

---

## 7. The combobox (lines 706–813)

Implements the **ARIA 1.2 combobox with listbox popup** pattern. Not a `<datalist>` — support across
screen readers is inconsistent.

| Function | Role |
|:--|:--|
| `suggest(term)` | Debounced (250 ms) search; short-circuits 9–14 digit input as a parcel number |
| `render(note)` | Builds `<li role="option">` items, sets `aria-expanded`, announces the count |
| `closeList()` | Collapses and clears `aria-activedescendant` |
| `highlight(i)` | Moves the visual and programmatic selection |
| `pick(i)` | Commits a choice, returns focus to the input, triggers `load()` |

### Focus stays in the input

The listbox is never focused. Selection is communicated by `aria-activedescendant` pointing at the
active option's `id`, and `aria-selected="true"` on that option. This is what lets a screen reader
user arrow through matches while continuing to type.

### The `seq` guard

```js
let seq = 0;
const mine = ++seq;
// … await …
if (mine !== seq) return;
```

Typing fires overlapping requests that can resolve out of order. Every async entry point takes a
ticket and discards its result if a newer request has started. Without this, a slow response for
`330` can overwrite the correct results for `3300`.

### Keyboard

<kbd>↓</kbd>/<kbd>↑</kbd> wrap around, <kbd>Home</kbd>/<kbd>End</kbd> jump, <kbd>Esc</kbd> closes,
<kbd>Enter</kbd> commits only when an option is active — otherwise it falls through to form submit.
`e.preventDefault()` is called only when the list is open, so normal input behaviour is untouched
when it isn't.

---

## 8. Submit handling (lines 815–847)

Covers people who type and press Enter without touching the suggestions.

```
empty            → error, focus back to the input
already picked   → load that parcel
9–14 digits      → treat as parcel number, zero-pad to 14
otherwise        → findAddresses()
                     0 results  → error naming what was typed + phone number
                     1 result   → load it
                     2+ results → show the list and let the user choose
```

That last branch matters: with several candidates the app **does not guess**. Guessing a parcel and
presenting it as fact is worse than asking.

Parcel numbers are `padStart(14,"0")` because `parcel_id` is a fixed-width 14-character string and
users drop leading zeros.

---

## 9. Loading a property (lines 849–906)

### `load(parcelId, label)`

1. Take a `seq` ticket, announce "Looking up…", clear previous results.
2. Fetch the parcel schema (cached) and the parcel record with `outFields=*`.
3. No record → explain, suggest it may be a new subdivision or outside Millcreek, give the phone
   number. **Never a bare "not found".**
4. Read the centroid from `parcel_latitude` / `parcel_longitude`.
5. Run `hits()` for every configured layer.
6. Call `draw()`.

### `hits(lon, lat, mine)`

One `Promise.all` over `CFG.LAYERS`, each doing a point-in-polygon query against the **parcel
centroid**:

```js
geometry: `${lon},${lat}`,
geometryType: "esriGeometryPoint",
inSR: "4326",
spatialRel: "esriSpatialRelIntersects"
```

`inSR=4326` because the parcel table stores decimal degrees while the services are in
NAD83 Utah Central feet (WKID 3566) — ArcGIS reprojects server-side.

Each result carries `{attrs, all, sch, failed, files}`. **A failed layer resolves rather than
rejecting**, so one broken service cannot blank the whole page; it renders "Temporarily unavailable"
with the phone number.

When `attachments: true`, it also lists the feature's attachments and builds their URLs. That fetch
is wrapped in its own `try` — a missing plat must not lose the zoning answer.

> **Centroid limitation.** A parcel can be partly inside an area while its centroid is outside. This
> is why Sensitive Land Areas uses the parcel's own precomputed field as the answer and the centroid
> test only as a cross-check, and why `GROUP_NOTES` states the limitation plainly.

---

## 10. Rendering (lines 908–1128)

### `pair(dt, dd, cls, linkText)`

Builds one `<dt>`/`<dd>` row and type-switches the value:

- **URL** → a link titled `linkText` if supplied, otherwise the field label. Never a bare URL
  (2.4.4). `linkText` comes from the layer's `nameField` or `linkName`, so a link reads
  "Rocky Mountain Power" rather than "Provider website".
- **Phone** → `phoneShaped()` recognises the shape, then `dialable()` decides. A `tel:` link is
  created **only** for 10 digits, or 11 starting with 1, and the display is normalised to
  `(801) 483-6900`. Anything else renders as plain text.
- **Otherwise** → text.

> **Why phones are validated.** The waste district's number is stored as `385468632` — 9 digits. The
> earlier code linked anything phone-shaped, producing a `tel:` link that cannot connect. For a
> screen reader user who cannot see that the number looks short, a dead link is worse than plain
> text. Malformed numbers now render unlinked, which also makes the data defect visible.

### Row shape

Both the configured and fallback branches emit the same shape: first row
`<Layer label> — <Field label>`, later rows just `<Field label>`. An earlier version prefixed
fallback rows with `↳`, which made unconfigured layers (electrical) look different from configured
ones. Removed for congruence.

### `ownerPair(raw, careOf)`

The Assessor packs multiple owners into one field:

```
ROBERT L NIELSON (JT); ROBIN L NIELSON (JT)
```

A screen reader reads that as one run-on string ending "jay tee". So: split on `;`, render a real
`<ul>` when there are several, and expand tenancy codes via the `TENANCY` map (`JT` → joint tenants).
Unknown codes pass through untouched. Whitespace-only `care_of` is dropped.

### `flagPair(label, isYes, detail)`

The 1.4.1-safe Yes/No: glyph (`aria-hidden`) + the word + colour.

### `draw(rec, sch, overlays, label, lat, lon)`

Builds the results in fixed order:

1. **Property record** — `PARCEL_FACTS`, then owner.
2. **Hazard and special designations** — `PARCEL_FLAGS`, each a `flagPair`, with a `.callout`
   explaining every "Yes". If nothing is flagged it says so explicitly rather than showing an empty
   card. Then the **Sensitive Land Areas cross-check**: if the parcel field and the centroid test
   disagree, a callout says the parcel is probably partly inside an area and to call.
3. **Grouped layer results** — one card per `group`, skipping `hidden` layers. Per layer:
   `failed` → unavailable message; `boolean` → Yes/No; `fields` → configured rows; otherwise → up to
   three fields using service aliases, filtered by `JUNK`. Attachments render last, followed by the
   scanned-plat explanation. Each card then gets its standing `GROUP_NOTES` disclaimer.
4. **Location** — centroid coordinates and a link to the visual map, framed as an option rather than
   the real version.

Ends by setting the heading text, revealing the section, announcing readiness, and calling
`head$.focus()` so a screen reader user lands on their results.

> **Announce and focus together.** The live region reports a short status; the focus move makes the
> heading read its own text. Slight redundancy is preferable to a silent update.

---

## 11. Copy and print (lines 1129+)

`#copy` walks the rendered cards and rebuilds them as indented plain text with a timestamp. If
`navigator.clipboard` is unavailable — insecure context, or permission denied — it appends a
**labelled, pre-selected `<textarea>`** and tells the user to press Ctrl+C. A copy button that fails
silently is a dead end for a keyboard user.

`#print` calls `window.print()`; the print stylesheet does the rest.

---

## 12. Data flow summary

```
user types
   ↓  debounce 250 ms, seq ticket
parseAddress()            normalise words, split number / street
   ↓
findAddresses()           tier 1 → 2 → 3 → 4, stop at first hit
   ↓
Address_Points            FullAdd / AddNum + StreetName  →  ParcelID
   ↓  user picks
load(ParcelID)
   ↓
Millcreek_Parcels         outFields=*  →  attributes + centroid lat/lon
   ↓
hits(lon, lat)            13 parallel point-in-polygon queries
   │                      + attachment listing where configured
   ↓
draw()                    headings, description lists, flags, callouts,
                          standing disclaimers, focus to results heading
```

No geometry is ever requested. No map library is loaded. Two `fetch` origins in total — the feature
services, and nothing else.

---

## 13. Why certain things look odd

**Why one 48 KB HTML file?**
Maintainers are GIS staff. No build step means no toolchain to install, no dependencies to age, and
a config change is a text edit and a commit. The cost is `'unsafe-inline'` in the CSP, documented in
`_headers`.

**Why `textContent` everywhere instead of `innerHTML`?**
The app renders third-party attribute values. `textContent` removes the injection path entirely.

**Why does a failed layer render text instead of disappearing?**
A silently missing flood determination reads as "not in a flood zone". That is the dangerous failure
mode, so failures are always visible and always paired with a phone number.

**Why is the phone number in error messages built by string concatenation?**
So `CFG.contact.phone` is the single source of truth. Changing it in one place updates every message.

**Why query the Sensitive Land Areas polygon at all if the parcel field is authoritative?**
To detect disagreement. Agreement is silent; disagreement produces a caution. Tested on a 60-parcel
sample with 0 disagreements, so the caution is rare rather than noise.

**Why is `multi` support absent for water providers?**
It was built, then removed. A single point can only fall inside two service-area polygons if those
polygons overlap — a topology defect in the source data, not two real providers. Listing both would
present a data error to a resident as a fact about their property. One answer from the centroid, plus
the standing disclaimer, is the honest treatment. The reasoning is left as a comment at the water
layer config so nobody re-adds it without reading it.

**Why link plat PDFs that cannot be made accessible?**
Because they are useful, and most people can read them. What would be wrong is implying they are
accessible. The app links them, states plainly that a screen reader cannot read them, and offers
staff to read the dimensions and easements aloud. That offer is also the alternative access a
§35.164 undue burden determination has to cite.
