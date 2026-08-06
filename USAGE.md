# Usage Guide

Three audiences, three sections. Skip to the one you need.

1. [For residents and the public](#1-for-residents-and-the-public)
2. [For front-counter and phone staff](#2-for-front-counter-and-phone-staff)
3. [For GIS staff maintaining the configuration](#3-for-gis-staff-maintaining-the-configuration)

---

## 1. For residents and the public

### Looking up a property

Type a street address or a parcel number into the search box, then pick your property from the list
that appears.

**You do not need to type the address exactly as the County records it.** All of these find the same
property:

```
3300 E Santa Rosa Ave
3300 East Santa Rosa Avenue
3300 EAST SANTA ROSA
3300 e. santa rosa ave.
3300 E Santa Rosa Ave, Millcreek, UT 84109
```

Grid addresses work spelled out too — `2760 South 2100 East` finds `2760 S 2100 E`.

**If you cannot find your property,** try just the house number and the street name and leave off
the direction and the street type — `3300 Santa Rosa`. If that still fails, call **801-214-2754**
and staff will look it up for you.

You can also search by **parcel number**, the 14-digit number on your tax notice. Around 66 parcels
in Millcreek have no street address and can only be found this way.

### Using a keyboard

| Key | Action |
|:--|:--|
| <kbd>Tab</kbd> | Move between the search box and buttons |
| <kbd>↓</kbd> / <kbd>↑</kbd> | Move through the list of matching addresses |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the first or last match |
| <kbd>Enter</kbd> | Choose the highlighted address |
| <kbd>Esc</kbd> | Close the list of matches |

The first link on the page is **Skip to main content**.

### Using a screen reader

The page announces the number of matches as you type, tells you if it had to broaden your search,
and moves focus to the **Results** heading when your property loads, so you land directly on the
information rather than having to hunt for it.

Results are organised under headings — Property record, Hazard and special designations, Zoning,
Subdivision and plat, Natural hazards, Representation, Services — so you can jump between them by
heading. Each item is a description list, so labels and values are correctly associated.

Yes/No answers are always spoken as the word "Yes" or "No", never conveyed by colour alone.

### Getting the results out

- **Copy results as text** puts everything on your clipboard as plain text.
- **Print results** produces a clean printout, disclaimer included.

### Reading the answers

**Hazard and special designations** are the regulatory flags that affect what you can do with your
property:

| Flag | What it means |
|:--|:--|
| FEMA flood hazard area | Flood insurance may be required by your lender; extra building standards apply |
| Wildland-Urban Interface | Wildfire-resistant construction and defensible space may be required |
| Sensitive Land Area | Additional review; slope, vegetation, stream corridor or wetland constraints may apply. Replaced the former FCOZ and RCOZ overlay zones |
| Historic designation | Exterior alterations may need historic review |

**The recorded plat** is the surveyed subdivision drawing showing lot lines, dimensions and
easements. It is a scanned image, so a screen reader cannot read it. Call **801-214-2754** and staff
will read or describe what you need — tell them the property and what you are looking for.

### Important limits

This tool reports the data of record. It is **not** a zoning verification letter, **not** a flood
determination for a lender or insurer, and **not** a decision about whether you can build.

Utility and hazard boundaries come from state agencies and providers. They are approximate, they
contain known gaps and overlaps, and this tool checks a single point inside your parcel — so a
property can be partly inside an area that shows "No". **Your utility bill or meter is the real
record of who serves you.** For anything binding, call Planning and Development Services.

### If something does not work

Phone **801-214-2754** or email **gis@millcreekut.gov**. Staff will provide the information in an
accessible format, normally **within 5 business days**, or sooner for a permit or hearing deadline.
Please also report the problem so it can be fixed.

---

## 2. For front-counter and phone staff

### What this tool is for

When a resident asks "what's my zoning", "am I in a flood zone", "who's my water company", "which
council district am I in", "what day is my garbage" — this answers all of it from an address, in a
few seconds, in a form you can read down the phone.

It is also the City's **published accessible alternative** to the zoning map. If someone says they
cannot use the map, this is what you point them to. You do not need to apologise for the map or
explain the rule — just offer this.

### Handling a request

1. Ask for the street address, or the 14-digit parcel number from their tax notice.
2. Type it in. Exact formatting does not matter.
3. Read the relevant section back. Use **Copy results as text** to paste into an email.

### Requests you must log

If someone contacts you **because they could not use a City map or this page**, that is an
accessibility request and it must be logged — date received, what was asked, what was provided,
date resolved. The log is the record that demonstrates the City responds, and it matters if the
City is ever asked to show it.

Route to GIS at **gis@millcreekut.gov**. The published commitment is **5 business days**.

### Questions to hand off, not answer

| Request | Send to |
|:--|:--|
| Zoning verification letter | Planning and Development Services |
| Flood determination for a lender or insurer | Planning; this tool is not sufficient |
| "Can I build X here?" | Planning |
| Plat dimensions, easements, setbacks | GIS or Planning — staff read the plat aloud |
| Disputed utility provider | The provider; the bill or meter is authoritative |

### What not to say

- Don't say the data is definitive. Utility and hazard boundaries are approximate.
- Don't say a property is *not* in a hazard area based only on this. It checks one point inside the
  parcel; part of the property may still be affected.
- Don't tell someone to "just use the map instead" if they've said they can't. That is the whole
  problem this exists to solve.

---

## 3. For GIS staff maintaining the configuration

Everything you need to edit is in the `CFG` object at the top of the `<script>` in `index.html`,
above the line:

```js
/* ==================================================================
   No further edits needed below this line.
   ================================================================== */
```

Edit, commit, push. Netlify redeploys automatically. If something breaks, revert the commit — the
previous deploy is one click away in Netlify.

### Contact details and the service commitment

```js
contact: {
  phone: "801-214-2754",
  phoneHref: "+18012142754",
  email: "gis@millcreekut.gov",
  sla: "within 5 business days"
}
```

This feeds every error message and every fallback offer in the app. **The response time is a public
promise** — if staff cannot meet 5 business days, change it here rather than leaving it unmet.

### Owner of record

```js
parcel: { showOwner: true }
```

Set `false` to hide it. The Assessor stores multiple owners in one semicolon-delimited field with
tenancy codes; the app splits them into a list and expands the codes (`JT` → joint tenants). Add
codes to the `TENANCY` map if you meet an unfamiliar one.

### Adding a data layer

```js
{ key:"mylayer",                       // unique short id
  group:"Services",                    // which results card it appears under
  label:"My layer",                    // what the resident sees
  url:"/My_Service/FeatureServer/0",   // path after CFG.org
  fields:{ FIELDNAME:"Friendly label" }
}
```

**Before you add it, check two things.**

**1. The layer index.** It is usually not 0.

```
https://services9.arcgis.com/XRrSFvEwSsReIxuA/arcgis/rest/services/<SERVICE>/FeatureServer?f=json
```

Known: Council districts **2**, water service **3**, fireworks **5**, subdivisions **7**.

**2. Whether the layer has usable attributes.**

```
.../FeatureServer/<index>?f=json
```

If `fields` contains only `OBJECTID` and shape fields, a field-driven display renders **blank**.
Use boolean mode instead:

```js
{ key:"myoverlay", group:"Zoning", label:"In my overlay area",
  url:"/My_Overlay/FeatureServer/0", boolean:true,
  note:"What this overlay requires." }
```

Boolean layers always print an explicit Yes or No. Word the `label` as a statement — "In a historic
district" — so "Yes" reads correctly after it.

**If you omit `fields` entirely,** the app reads field aliases and coded-value domains from the
service and shows the first three useful fields. Fine for a quick addition; name the fields
explicitly for anything resident-facing.

### Layer options

| Option | Effect |
|:--|:--|
| `fields` | Which attributes show, and their labels. Order is preserved |
| `boolean: true` | Render as Yes/No. Use for layers with no attributes |
| `note` | Explanation shown when a boolean layer is "Yes" |
| `hidden: true` | Query it but don't display — used for cross-checks |
| `attachments: true` | Also fetch attached files (the recorded plat) |
| `attachmentLabel` | Link label for attachments |
| `nameField` | Field holding the organisation's name. Used as **link text**, so a link reads "Rocky Mountain Power" rather than "Provider website" |
| `linkName` | Same idea, but a fixed string — for layers with no name field (the waste district) |

### Row shape is the same for every layer

The first row of a layer reads `<Layer label> — <Field label>`; every later row is just
`<Field label>`. No arrows or indent markers. **Always configure `fields`** for anything
resident-facing — the unconfigured fallback grabs the first three attributes it finds, which is how
an irrelevant Salt Lake County contact once appeared under Services (it came from the fireworks
layer, since removed).

### Links and phone numbers

URL values become links titled by `nameField` / `linkName`, falling back to the field label. Never a
bare URL — that fails 2.4.4.

Phone values become `tel:` links **only if they are actually dialable** — 10 digits, or 11 starting
with 1 — and are reformatted as `(801) 483-6900`. Anything else renders as plain text. This matters:
the waste district's number is stored in the data as `385468632` (9 digits), and a `tel:` link that
fails to connect is worse than plain text for someone who cannot see that the number looks wrong.
**If you see a number rendered as plain text, that is a data defect worth fixing at source.**

### Hazard flags

`CFG.PARCEL_FLAGS` reads precomputed fields on the parcel record. **Prefer these over polygon
layers where the field exists** — they are calculated against the whole parcel boundary, whereas
layer queries use only the centroid.

```js
{ field:"in_wui", label:"In the Wildland-Urban Interface",
  yes: v => /^y/i.test(v||""),
  detail: v => "FEMA zone "+v,          // optional
  note:"Wildfire-resistant construction may be required." }
```

`note` is the plain-language explanation. **Write it for a resident, not a planner.** A code with no
explanation is not an answer.

### Standing disclaimers

```js
GROUP_NOTES: {
  "Services": "Utility service area boundaries are compiled from state agency…",
  "Natural hazards": "Hazard boundaries are regulatory mapping products…"
}
```

Shown every time with the whole group, keyed by `group` name. These exist because utility and hazard
data are third-party products with real topological defects. **Do not remove them.** If you add a
group carrying third-party data, add a note for it.

### Address matching

Two tables, no logic changes needed:

```js
synonyms: { EAST:"E", AVENUE:"AVE", DRIVE:"DR", ... }
streetAliases: { "MILL CREEK":"MILLCREEK", "DEER CREEK":"DEERCREEK" }
```

`synonyms` maps spelled-out words to the abbreviation the data stores. `streetAliases` handles local
variants.

**Rule for `streetAliases`: only map a variant that does not already exist as its own street name.**
Both `MILLCREEK CANYON` and `MILLCREEK CYN` exist in the data — aliasing one to the other would hide
real addresses.

To find the real street names:

```
.../Address_Points/FeatureServer/0/query?where=UPPER(StreetName) LIKE '%YOURTEXT%'
   &outFields=StreetName&returnDistinctValues=true&returnGeometry=false&f=json
```

### After any change — check these

- [ ] Search `3300 East Santa Rosa Avenue`. Results load, no blank rows.
- [ ] **Tab through with a keyboard only.** Every control reachable, focus always visible.
- [ ] Arrow keys move through the address list; <kbd>Esc</kbd> closes it.
- [ ] Any new boolean layer shows Yes **or** No, never blank.
- [ ] New third-party layer has a `GROUP_NOTES` entry.
- [ ] Test over `http://localhost`, **not** by double-clicking the file. Over `file://` the browser
      blocks the ArcGIS request and every lookup fails even though nothing is wrong. The app warns
      you on load if you do this.
- [ ] Browser console is clean. Errors are logged as `[lookup] … <kind> <message>` — the kind tells
      you whether it was the network, the browser, rate limiting, or a rejected query.
- [ ] A CSP error means a new host needs adding to `_headers`.
- [ ] Print preview still includes the disclaimer.

### Adding a layer from a different host

The CSP allows `services9.arcgis.com` only. Add the new origin to `connect-src` in `_headers` or
every query fails silently:

```
Content-Security-Policy: … connect-src https://services9.arcgis.com https://newhost.example.gov; …
```

### What not to change without care

- The `<h1>`/`<h2>`/`<h3>` structure — screen reader users navigate by it.
- The `aria-live` status region — removing it makes results silent.
- `head$.focus()` after a lookup — this is what lands users on their results.
- Anything in the combobox keyboard handling.
- The static "Prefer to ask a person?" section. It is plain HTML on purpose so it survives a
  JavaScript failure. Never move it into rendered content.
