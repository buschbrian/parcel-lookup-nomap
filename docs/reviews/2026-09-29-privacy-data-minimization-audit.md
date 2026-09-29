# Privacy audit — 2026-09-29

Read-only check of what the two lookup pages collect or send, measured against the Utah privacy
law that applies to them. Audited `main` at `7561711` and the live site on 2026-09-29 (real
browser, every request, cookie and storage area recorded, using the synthetic address
`1344 E Chambers Ave`). No code or configuration was changed.

This is a technical finding, not legal advice. Where a conclusion turns on how a statute is read,
it is marked **for the City Attorney**.

## The law that applies

All are in the Utah Government Data Privacy Act, Utah Code Title 63A, Chapter 19. Text read on
le.utah.gov on 2026-09-29.

| Provision | What it requires | Why it applies here |
|---|---|---|
| **63A-19-402.5(1), (3)** (eff. 3/27/2025) | A government website must give notice of: the responsible entity; how to contact it; how a user seeks access to, and asks to correct, their personal data or user data; how to file a complaint with the data privacy ombudsperson; and how an at-risk employee asks for private classification under 63G-2-302. It must be "prominently" posted on the homepage, or linked. | The lookup is a "government website": pages "operated by or on behalf of a governmental entity" (63A-19-101(17)). Subsection (1) has no size or collection threshold. |
| **63A-19-402.5(2), (4)** | A website that "collects user data" must also disclose: tracking technology used; what user data is collected; all purposes and uses; classes of persons it is shared with or sold to; and the record series. The entity "may not collect user data … unless" it has complied. | "User data" is information "automatically collected by a government website when a user accesses" it, including information showing the user "requested or obtained specific materials or services" (63A-19-101(39)). Every lookup sends the visitor's IP and the searched address or parcel to the hosts below. Whether that is "collected" turns on whether any host logs it (open question 1). |
| **63A-19-401(2)(a)(ii)** (eff. 5/6/2026) | Obtain and process "only the minimum amount of personal data reasonably necessary to efficiently achieve a specified purpose." | This is the data-minimization rule. It is the standard the findings below are measured against. |
| **63A-19-401(3)(a)** | No "undisclosed or covert surveillance of individuals unless permitted by law." | Why the notice must state what is sent and logged. |
| **63A-19-401(2)(a)(iv)** | Processing that began before 5/7/2025 must be identified and given a compliance strategy "no later than July 1, 2027." | The lookup predates this date, so any gap found here goes on the City's privacy program report by that date. Subsection 402.5(4) is not subject to this grace period. |
| **63A-19-404(1)** (eff. 5/1/2024) | An entity that collects personal data must retain and dispose of it under "a documented record retention schedule." | Applies to any host log that keeps searches (open question 2). |

Not a requirement: **63A-19-402** (notice where an entity "requests or collects personal data").
The pages ask for no name, email or account, only an address or parcel number; that is likely
outside it, and public-record data would need only a one-line statement under 402(2)(a).
**For the City Attorney.**

## What the pages do

Verified in code and live.

| Finding | Evidence | Relevance |
|---|---|---|
| **Nothing is stored on the visitor's device.** No cookies, no `localStorage`/`sessionStorage`/IndexedDB, no service worker, no Cache API. | Empty after a full lookup on both pages. No `Set-Cookie` on either page. | 402.5(2)(a): no tracking technology. |
| **No analytics or third-party code.** A page load makes two requests, both to the Millcreek host. | Live network log. CSP `default-src 'none'`, `connect-src` limited to two hosts. | Same. |
| **The typed address is sent to Esri as typed, including partial strings.** After 3 characters and a 250 ms pause the text so far is sent as a GET `where` filter to Millcreek's ArcGIS Online layers on `services9.arcgis.com`. | `findAddresses`, `rawQuery`; live requests. | Necessary to search. Cannot be reduced to nothing; it could be reduced (longer minimum length or pause). Must be disclosed. |
| **The parcel's boundary and centre point are sent to the Esri layers and, on the property lookup, to FEMA (`hazards.fema.gov`).** 47 requests on the property lookup, 5 on the licensing lookup. | Live requests; `hits`. | Necessary: the boundary decides the flood and overlay answer, and rounding it would change published results (`CODE.md`). FEMA is a federal service Millcreek does not operate. Must be disclosed as a sharing class. |
| **Only the origin is sent as `Referer`.** No path, no `?parcel=`. | Observed live; `Referrer-Policy: strict-origin-when-cross-origin`. | Meets minimization; no action. |
| **The app writes nothing anywhere that leaves the device, except the requests above.** The only places a searched value is rendered are the visitor's own address bar (`?parcel=<id>` after a property lookup; the address is never written) and, on an address-search failure, the browser console (`index.html:1829`, `business-licensing.html:464`, which print the failing URL including the typed address). No error reporter or beacon. | Code; reproduced live by blocking the service. | Not "collected" by the City. Both are optional to remove; a decision, not a legal requirement (open question 5). |

Reviewed and **not** relevant to these sections, so not carried further: Copy/Print buttons
(local); outbound links the visitor chooses to follow; the owner-of-record display (a display of
public Assessor records, a policy choice recorded in `SECURITY.md`, not a collection); CI and test
tooling (synthetic address only); the staff phone and email contacts.

## Who runs each service the pages call

- **Millcreek's own layers, hosted by Esri.** Every Millcreek layer URL begins
  `services9.arcgis.com/XRrSFvEwSsReIxuA`. That ID is the **Millcreek ArcGIS Online organization**
  (its portal record reads "Millcreek", key `Millcrk`), and the organization's service directory
  lists all 20 layer services the two pages call (address points, parcels, zoning, hazards, districts,
  utilities, short-term rentals). The layers are the City's own items; Esri is the cloud platform
  that hosts them. This is the ordinary meaning of a site "operated … on behalf of" the City
  (63A-19-101(17)); the City Attorney should confirm that reading.
- **FEMA National Flood Hazard Layer, `hazards.fema.gov`.** A federal service, not operated for the
  City. Sending it the parcel boundary is sharing with another governmental entity, which is what
  402.5(2)(d)(i) asks a notice to list, if user data is collected.

## Gap to raise

The pages link the City's privacy notice at `millcreekut.gov/125/Disclaimer` (PR #41). That page
links a **Privacy Notice effective April 17, 2024**, written for `www.millcreekut.gov` and in-person
services. What the City's site (searched 2026-09-29) does and does not say:

| 402.5 needs | Found on millcreekut.gov |
|---|---|
| Responsible entity and contact | The notice names "the City's IT Manager" as contact. Ordinance 25-52 (Council, 12/8/2025) adds data privacy to Millcreek Code ch. 2.82 and designates the **City Manager as chief administrative officer** under 63A-19-101; the notice still names the IT Manager. |
| How to get and correct your data | One sentence in the notice that an individual "is granted the ability to access and correct personally identifiable information"; no procedure. Public records requests: `millcreekut.gov/384/Record-Requests` (GRAMA, City Recorder). |
| Complaint to the data privacy ombudsperson | **Not found** on the City's site. |
| At-risk employee request (63G-2-302) | **Not found** on the City's site. |
| Record series for user data | **Not found.** The notice says only that retention "follows the City's records retention schedule"; no schedule is named or published. |
| This site, and Esri and FEMA as recipients | **Not covered.** The notice describes `www.millcreekut.gov` and states that site "collects certain information automatically and stores it in log files," which is not true of the lookup (see below). |

The gaps are the City's to close, not this repository's. Whether the current notice satisfies 402.5
for this site, and whether a lookup-specific addendum is needed, **is for the City Attorney**. The
City's rewrite (`docs/changes/CHANGES-2026-09-15.md` §4) is the natural place to fix it.

## Logging and retention

**Owner statement (2026-09-29, site owner, City GIS):** the City does not log requests to the lookup
pages and keeps no data from them. This audit found no logging code, no analytics and no
configuration in the repository that contradicts it, but it cannot see Azure or ArcGIS Online
settings, so the statement is recorded as the owner's and is not independently verified. It does
not cover Esri's or FEMA's own systems, which the City does not control.

Consequences, **for the City Attorney to confirm**:

- If the City collects and keeps no user data, the extra disclosures in 402.5(2) (data collected,
  purposes, sharing, **record series**) and the retention rule in 63A-19-404 have nothing to attach
  to for the City's own systems. The 402.5(1) items (entity, contact, access, correction,
  ombudsperson, at-risk employee) still apply to the site.
- The City's linked notice says its website stores visitor data in log files. It should not be read
  as describing this site.
- **If** any request data were ever retained, the candidate Utah State Archives series is
  **GRS-1720, "Transitory tracking records"** ("…includes internet website visitor information";
  retain 1 year or until administrative need, whichever is less, then destroy). Nothing found ties
  that series to the City's practice, and the City's own schedule is not published on its website.
  The City Recorder can say which schedule the City follows.

## Open questions

1. **Confirm the owner statement before it is published** (Azure and ArcGIS Online diagnostic
   settings are off; nothing in front of the app logs). Owner: City GIS.
2. **Record series:** none is needed if nothing is retained. If the City Attorney disagrees, the
   City Recorder names the schedule (candidate: GRS-1720 above).
3. **Ombudsperson and at-risk-employee text:** neither is on the City's site. City to supply, or
   confirm where it lives.
4. **For the City Attorney:** confirm the "operated … on behalf of" reading of the Esri-hosted
   layers, and whether the April 2024 notice suffices or a lookup addendum is needed.
5. **Optional, not legal requirements:** keep or remove `?parcel=` in the address bar, and keep or
   strip the URL from console messages. Both are on the visitor's own device.

## Draft notice

> **DRAFT — NOT APPROVED. For review by the City before any use.** Not legal advice. Limited to
> what the audit above showed. States no retention period and no legal basis. Bracketed items
> must be completed or removed before use; the notice must not be published with brackets in it.

### Privacy: Millcreek Property Lookup

This page is operated by Millcreek. It covers the property lookup and the short-term-rental
licensing lookup. To reach the City, or to ask about access to or correction of your information,
see the City's [Privacy Notice](https://www.millcreekut.gov/DocumentCenter/View/4317/Millcreek-Privacy-Notice)
and its [Record Requests page](https://www.millcreekut.gov/384/Record-Requests). [City to supply:
how to complain to the state data privacy ombudsperson, and how an at-risk employee asks for
private classification. Neither is on the City's site today.]

**What you type.** When you type an address or parcel number, the page sends it to the map and
data services that hold the answers. Addresses are searched as you type, so part of an address may
be sent before you finish. Those map layers belong to Millcreek and are hosted on Esri's ArcGIS Online cloud
service. The property lookup also asks FEMA's flood hazard service about the property; to do
that, it sends the shape and location of the parcel you chose.

**What this page does not use.** No cookies. Nothing stored in your browser between visits. No
advertising or analytics tools. No code, fonts or images from other companies.

**What stays on your device.** After a property lookup, the page adds the parcel number (not the
address) to the web address so the report can be reloaded or shared. It can appear in your browser
history and in links you copy. Selecting **Clear** removes it from the address bar. If a search
fails, the page may show the request, including the address you typed, in your browser's developer
console.

**Records of your visit.** The City does not log requests to this page and keeps no information
about your visit. [OWNER STATEMENT — City to confirm before publishing.] Esri and FEMA run their
own systems; their own privacy notices apply to what they receive.
