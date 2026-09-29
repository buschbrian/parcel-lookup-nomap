# Privacy and data-minimization audit — 2026-09-29

Read-only audit of every point where the two lookup pages collect, log, store or send personal
data. It supports the records committee's data-minimization check. Nothing in the repository's
code, configuration or production was changed by it.

**What was audited.** `main` at `7561711`, and the live site at <https://lookup.gis.millcreekut.gov/>
on 2026-09-29. The deployed `index.html` is the same size as the repository's (143,039 bytes), and
the deployed pages carry release `2026.09.15`.

**How claims were checked.** Against the code and against live behavior, not against the docs:

- Source of `index.html`, `business-licensing.html`, `public/staticwebapp.config.json`, the
  workflows and the test configuration were read.
- Both live pages were loaded in a real browser with every request, cookie, storage area, service
  worker and cache recorded, while looking up the published synthetic address
  `1344 E Chambers Ave` (a City-owned parcel).
- The live response headers were fetched.
- The address-search failure path was forced in the browser to see exactly what the page writes to
  the console.

Where a claim could not be checked from here, it is marked **UNVERIFIED** and listed under
[Open questions](#open-questions).

## Bottom line

- **The pages themselves keep nothing about a visitor.** No cookies, no `localStorage` /
  `sessionStorage` / IndexedDB, no service worker, no Cache API, no analytics, no tracking, no
  third-party scripts, fonts or images. Verified live on both pages.
- **Searched addresses are not logged by the pages, but they do leave the visitor's browser.**
  Each search is sent, as typed, to the Esri-hosted ArcGIS services that hold Millcreek's address
  and parcel data. Whether those services, or the Azure host, keep request logs is **UNVERIFIED**.
- **Searched addresses are written to one log: the visitor's own browser console.** When an address
  search fails, the page prints the failing request URL, which contains the typed address, to the
  browser's developer console. It is not transmitted anywhere (see CP-7).
- **A successful lookup on `index.html` puts the parcel number (not the address) in the address bar**
  (`?parcel=…`), which then lives in browser history and in any link the visitor shares (CP-6).

## Collection points

"Needed" means the page cannot do its job without it. "Recommendation" is keep or strip; strips
are marked as optional where the data never leaves the visitor's device.

| # | What | Where it goes | Retention | Needed? | Recommendation |
|---|---|---|---|---|---|
| CP-1 | **Typed address text.** After 3 characters and a 250 ms pause, the text typed so far is sent as a `where` filter, so a visitor who types `1344 E Cham` and pauses sends that partial string, and again as they keep typing. A failed tier is followed by up to three broader searches on the same text. Sent on both pages. Sent as GET query parameters. Code: `findAddresses`, `rawQuery` | The Address Points layer in Millcreek's ArcGIS Online organization, on `services9.arcgis.com` (Esri) | **UNVERIFIED** (Esri-side and Millcreek-organization-side logging; not in this repo) | Yes — this is the search | **Keep.** No smaller request would work. Disclose it. |
| CP-2 | **Parcel number** (typed, or resolved from the chosen address), sent as `parcel_id='…'` to the parcel layer, which returns the parcel record with geometry. Both pages | Millcreek parcel layer, `services9.arcgis.com` | **UNVERIFIED** | Yes | **Keep.** |
| CP-3 | **The parcel's boundary polygon and centre point**, sent to many layers, one request per layer. 47 requests for one `index.html` lookup as observed; 5 on the licensing page (both counts include the address search). Sent as GET, or as a form POST above 1,900 bytes. Code: `hits`, `transportFor` | Millcreek's layers on `services9.arcgis.com`; and, `index.html` only, **FEMA's National Flood Hazard Layer at `hazards.fema.gov`** (a federal server Millcreek does not operate) | **UNVERIFIED** for both hosts | Yes — the boundary is what decides flood and overlay results (`CODE.md`) | **Keep.** Rounding or simplifying the boundary would change published answers. Disclose that FEMA receives it. |
| CP-4 | **IP address, browser/user-agent and request time** — sent by the browser on every request, whatever the page does | The Millcreek host (`lookup.gis.millcreekut.gov`, Azure Static Web Apps); Esri; FEMA | **UNVERIFIED.** Nothing in the repo configures or reads request logs | Unavoidable for any HTTP request | **Keep**, but the owner must confirm what each host records and for how long before the notice says anything about it. |
| CP-5 | **`Referer` header** on requests to Esri and FEMA. Header is `Referrer-Policy: strict-origin-when-cross-origin` | The same third parties | n/a | Not needed | **Keep as is.** Observed live: the `Referer` on cross-origin requests is the site origin only, with no path and no `?parcel=`. |
| CP-6 | **`?parcel=<14-digit id>` in the address bar**, written by `history.replaceState` after a successful `index.html` lookup. The typed address is *not* written (code comment cites `SECURITY.md`). Confirmed live: the URL became `…/?parcel=16283040280000`. The licensing page does not do this (confirmed live). Cleared by **Clear** | The visitor's browser history and address bar; any link they copy or share. The host also sees it in the request URL whenever someone opens such a link | The browser's own history; no app-side retention | A convenience (shareable/reloadable report, item A6), not needed to get an answer | **Keep — committee decision.** A parcel number is a public-record identifier but can be tied to an owner, and on a shared computer it persists in history. Stripping it is one deleted `replaceState` call plus the deep-link feature. |
| CP-7 | **Console diagnostics.** On a failed request the pages call `console.error(…, e.detail)` where `detail` is the full request URL, so **the typed address appears in the console** as `where=UPPER(FullAdd) LIKE '1344 E CHAMBERS AVE%'`. Reproduced live by blocking the address service. Code: the address-search handlers, `index.html:1829` and `business-licensing.html:464`. The property-load and coverage-query handlers (`index.html:2036`, `2085`, `2089`; `business-licensing.html:538`) print the parcel-query URL, which carries the parcel number or boundary rather than the typed text. Submit-time failures (`index.html:1972`, `business-licensing.html:547`) print the error kind and message only | The visitor's browser developer console only. No `onerror` / `unhandledrejection` handler, no `sendBeacon`, no error-reporting script; the CSP allows connections to only the two service hosts | Until the tab or console is closed | For staff diagnosing a problem by phone (`docs/changes/CHANGES-2026-08-06.md`) | **Keep (device-local); strip is optional.** If the committee wants no rendering of the address anywhere, print `e.kind` and `e.message` only. |
| CP-8 | **Clipboard.** **Copy results as text** writes the visible results to the clipboard; **Print** opens the print dialog | The visitor's own clipboard / printer. Not transmitted | Outside the app's control | Optional, user-initiated | **Keep.** |
| CP-9 | **Outbound links the visitor chooses to follow.** The "interactive zoning map" link carries the property's latitude/longitude (`?lon=…&lat=…&scale=…`) to `planning.gis.millcreekut.gov`; the "Salt Lake County Assessor" link and any attachment links come from data records; `tel:` and `mailto:` links open the visitor's phone or mail program | The linked site (City-controlled for the map; Salt Lake County; Esri) | Governed by the destination | Optional, user-initiated | **Keep.** State in the notice that following a link leaves this site. |
| CP-10 | **Personal data shown, not collected.** `index.html` displays the **owner of record and care-of name** from the parcel record (`showOwner: true`). The licensing page requests only `parcel_id` and `prop_location` | Displayed to the visitor; copied only if the visitor uses Copy | The pages store none | Policy decision recorded in `SECURITY.md` (public Assessor record) | **Keep — committee decision.** This is the largest personal-data exposure in the app and it is a display choice, not a collection. It is included so the committee sees it. |
| CP-11 | **Cookies.** None set. No `Set-Cookie` on either page's response; the browser's cookie jar was empty after a full lookup on both pages | — | — | — | **Keep as is.** |
| CP-12 | **Browser storage.** None: `localStorage`, `sessionStorage`, IndexedDB, service workers and Cache API were all empty after a full lookup on both pages. The only in-memory cache is a per-page-load layer-schema map | — | Ends with the tab | — | **Keep as is.** |
| CP-13 | **Analytics, tracking, third-party code.** None. A page load makes two requests, both to the Millcreek host (the HTML and the logo). The CSP is `default-src 'none'`, `script-src 'self' 'unsafe-inline'`, `connect-src` limited to the two service hosts, `font-src 'self'`, `img-src 'self' data:` | — | — | — | **Keep as is.** A CI test asserts the CSP. |
| CP-14 | **Azure hosting configuration in the repo.** `public/staticwebapp.config.json` sets headers, caching and a navigation fallback only — no `platform` block, no auth, no API, no logging or telemetry setting. The repo cannot show Azure-portal settings (diagnostic settings, linked monitoring, DNS/front-door layers) | Azure | **UNVERIFIED** | — | **Owner to confirm** — see Open questions. |
| CP-15 | **CI and test tooling.** `check-services`, the live monitor and `test:production` use the synthetic address only. `test:production` reads a real parcel record at test time but disables trace, screenshot and video and blanks the results before finishing; a unit test enforces it. Uploaded evidence is counts and timings, kept 90 days | GitHub Actions artifacts | 90 days (workflow setting) | Yes | **Keep.** |
| CP-16 | **Staff-assisted route.** The pages offer a phone number and an email address. A visitor who contacts staff supplies whatever they say or write; `USAGE.md` requires accessibility requests to be logged (date, request, what was provided, date resolved) | Staff mailbox / the accessibility log | Not defined in the repo | Yes, by design | **Keep**; owner to say where the log lives and how long it is kept. |

## Findings

1. **No app-side logging of searches.** Nothing in either page sends a search anywhere except the
   ArcGIS and FEMA queries needed to answer it.
2. **The typed address is sent to Esri in the clear text of the query (CP-1), including partial
   strings, on every keystroke pause.** This is inherent to a type-ahead search against a hosted
   feature service. It can be reduced (longer minimum length, longer debounce), not removed.
3. **FEMA receives the parcel's boundary (CP-3).** It is a federal service and Millcreek has no
   say over its logging.
4. **The typed address is rendered into the visitor's own console on failure (CP-7).**
5. **`SECURITY.md` says the site "stores nothing about a visitor" and "holds no … resident-submitted
   data".** That is true of the pages and confirmed live, but it does not speak for what the
   hosting or the ArcGIS services record. The notice below is worded to avoid repeating that
   claim beyond what was proven.
6. **Extra response headers exist that the repo does not set** (`X-XSS-Protection`,
   `X-DNS-Prefetch-Control`). They arrive from the hosting layer, which is consistent with the
   hosting layer not being fully described by this repo.

## Open questions

For the site owner. None can be answered from the repository.

1. **Azure Static Web Apps (production app):** is Application Insights, Log Analytics or any
   diagnostic setting enabled, or has one ever been? If so, what does it capture (URL and query
   string included?) and what is the retention?
2. **Anything in front of or beside the Azure app** (Azure DNS zone `gis.millcreekut.gov` is
   delegated to Azure per `docs/decisions/0002`): does any CDN, firewall or proxy log requests?
3. **Millcreek's ArcGIS Online organization:** are service usage or request logs kept, who can see
   them, do they include query text (address searches), and for how long? Is the organization
   configured to record anything beyond Esri's defaults?
4. **Esri and FEMA:** what do they record on their own? The notice can only point to their
   notices; who at the City owns confirming this?
5. **`?parcel=` in the address bar (CP-6):** does the committee accept it, or should the
   deep-link feature be removed? (A design choice; it is not needed to get an answer.)
6. **Owner-of-record display (CP-10):** confirm this stays as a deliberate policy decision.
7. **Console detail (CP-7):** strip the URL from the console message, or keep it for phone
   support?
8. **The Planning web map's "Property information" popup** is described in code comments as a
   source of inbound `?address=` and `?parcel=` links. That other application was not audited
   here; the lookup pages accept those links but never write `?address=` themselves.
9. **The accessibility-request log (CP-16):** where it lives, who can read it, how long it is
   kept, and whether the retention schedule already covers it.
10. **The `mailto:` and `tel:` contacts:** messages sent to the staff mailbox are outside the
    app; is the mailbox's retention covered by the same policy?

## Draft privacy notice

> **DRAFT — NOT APPROVED. For review by the City before any use.** Not legal advice. Wording is
> limited to what the audit above showed. It does not state a retention period, a legal basis or
> a legal citation, because none was established. Bracketed items must be completed or removed
> before use.

### Privacy: Millcreek Property Lookup

This page explains what the Millcreek Property Lookup does with what you type. It covers the
property lookup and the short-term-rental licensing lookup. For the City's general website
privacy notice, see the link at the bottom of the page.

**What you type.** When you type an address or parcel number, the page sends it to the map and
data services that hold the answers. Addresses are searched as you type, so part of an address
may be sent before you finish. These services are hosted by Esri, for Millcreek's parcel, zoning
and address data. The property lookup also asks FEMA's flood hazard service about the property.
To do that, it sends the shape and location of the parcel you chose.

**What this page does not do.** The lookup pages do not use cookies. They do not store anything
in your browser between visits. They do not use advertising or analytics tools, and they do not
load code, fonts or images from other companies. The pages do not keep a list of what people
search for.

**What stays in your browser.** After a property lookup, the page adds the parcel number (not the
address) to the web address, so the report can be reloaded or shared. That parcel number can
appear in your browser history and in any link you copy. Selecting **Clear** removes it from the
address bar. If something goes wrong, the page may show the request, including the address you
typed, in your browser's developer console. That stays on your device.

**Property owner information.** The property lookup shows the owner of record and care-of name
from the county parcel record. This is information the county Assessor publishes.

**Technical information from your visit.** [TO BE COMPLETED after the owner confirms what the
City's web host, Esri and FEMA record, and for how long. Do not publish this paragraph until it
is filled in or removed.]

**Links to other sites.** Some results link to other sites, such as the Salt Lake County
Assessor, and the City's interactive zoning map. The zoning map link includes the property's
coordinates. Once you follow a link, that site's own privacy notice applies.

**If you contact us.** If you call or email the number or address shown on the page, we receive
what you tell us. [TO BE COMPLETED: how requests are recorded and kept.]

**Questions.** Contact the GIS office using the phone number and email shown at the bottom of
the page.
