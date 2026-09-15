# ADR-0003: Report every zoning district that covers a parcel

## Status

Accepted.

## Date

2026-09-10

## Context

Base zoning, future land use and the City Center Overlay were read from the parcel's stored point:
one ArcGIS query per layer, `esriGeometryPoint`, first match wins. A point is not a property, and on
10 September 2026 two real parcels showed what that costs.

Parcel `15353000130000` reported **"Not in this area"** for base zoning. Its stored point falls in a
gap in the published zoning map. Queried with its own boundary, the parcel intersects an A-1 district
— verified live: point query 0 features, boundary query 1. "Not in this area" is not a hedge here, it
is a false statement about a resident's property: every parcel in Millcreek has zoning.

Parcel `16263780070000` reported one district. The zoning map draws a C-2 boundary against it, so the
property touches two designations and a single point can only ever name one of them. Live: the
boundary intersects C-2 and R-1-8, probes inside the parcel confirm R-1-8, and no district contains
the whole parcel.

Both failures are silent. A resident cannot tell a gap in the map from a property with no zoning, or
one district from the one of two that happened to contain a point, and neither can the staff member
reading the same page to them on the phone. This is the most consequential answer the lookup gives:
it is what people act on when they ask what they may build.

Three facts constrain any fix. The pages are self-contained inline vanilla JavaScript with no
dependency and no bundler runtime. The Content-Security-Policy allows exactly two data hosts, and
both header files would have to change to add a third. And ArcGIS's `relationParam`
(`esriSpatialRelRelation`) is documented as unsupported on hosted feature services.

## Decision

Query the three layers with the **whole parcel boundary** and report **every designation the map
places on the property**, with an explicit sentence for each state of the evidence.

Each coverage layer is asked three questions per lookup, with standard parameters, against the same
services:

| | Question | Parameters |
|:--|:--|:--|
| Q1 | What does the boundary touch at all? | parcel polygon, `esriSpatialRelIntersects`, explicit `outFields` |
| Q2 | Which of those cover area inside the parcel? | multipoint of probe points, `esriSpatialRelIntersects`, `outFields=<oidField>` |
| Q3 | Does one contain the whole parcel? | parcel polygon, `esriSpatialRelWithin`, `outFields=<oidField>` |

**The probe rule.** The centres of a 5×5 grid over the parcel's bounding box, offered together with
the parcel's stored point, each rounded to six decimals **first** and then kept only if the rounded
point lies strictly inside an outer ring and outside every hole, by even–odd ray cast. A point lying
on a ring is rejected. At most 25 points are sent. Rounding happens before the test so that the point
sent is the point proven inside; rounding afterwards could move a point across a boundary and turn
evidence into a claim about the neighbouring district. The stored point receives no privilege — an
exterior, in-hole or on-boundary stored point is dropped like any other failing probe. If no probe
survives, or there is no usable boundary, the layer runs a real query at the stored point and says
that only the centre was checked.

This rounding applies to probe points only. The parcel boundary is never rounded, simplified or
generalised anywhere in the request path — see ADR-0001's successor discussion in
`docs/changes/CHANGES-2026-09-10.md` §2.

**Probes are evidence of presence, never proof of absence.** A grid steps over narrow strips; a
district it missed is reported as a touch the check could not confirm, and is still shown. Nothing Q1
found is ever suppressed, and no percentage, size or proportion is ever published, because none is
measured. The words "most", "small" and "too small" do not appear in any of these sentences.

**The direction of `esriSpatialRelWithin` is pinned by a live contract, not assumed.** The REST
reference does not state which operand is which. Verified 10 September 2026: a 4 m square inside
parcel `16261060200000` is returned by the parcel layer under `Within` and not under `Contains`, so
`Within` means "the geometry sent is inside the feature returned". `check-services.mjs`'s
`spatial-relation-direction` contract re-establishes that on every run, because getting it backwards
would invert the page's most confident sentence.

**Identity is the designation, not the feature.** Zoning and future land use group features by a
field value (`ZONE_`, `LandUse`), so two adjacent polygons carrying the same code are one answer. The
City Center Overlay has no such field — membership is the whole answer — so every feature it returns
maps to one constant local key and no designation field is requested. Q2 and Q3 return the object id
alone and join back to Q1 by it; grouping happens after the join.

**Evidence and request health are separate outputs.** `coverageState()` returns `{state, health}`. A
failed probe query does not make a district Q3 says contains the parcel any less contained, so the
state says what was found and separate lines say what could not be checked. Every warning renders
beside a real answer, never in place of one.

**A response is only an answer if it carries a `features` array.** A body without one is a failed
query rather than an empty result, because the difference between "we do not know" and "No" is the
entire subject of this decision. `exceededTransferLimit` is followed with `resultOffset` under three
bounds: at most `CFG.coverage.maxPages` requests, a page repeating an earlier page's object ids stops
paging immediately, and every page carries the lookup's abort signal.

**The City Center Overlay stays optional.** Zoning and future land use carry `expectedCoverage: true`,
so nothing found is a gap in the map. The overlay does not, so a complete query that finds nothing is
a real "No" — and an edge-only touch no probe confirms is **Unknown**, not Yes, because a boundary
clipping a corner is not the property being in the overlay.

## Alternatives Considered

### Keep the point query and reword the failure

Change "Not in this area" to something softer and leave the method alone. One line of work, no new
requests.

Rejected because it fixes the wording of a wrong answer. Parcel `15353000130000` would still be told
nothing was found when its property plainly intersects a district, and `16263780070000` would still
be told about one of its two districts. Softer words on the same false negative are worse, not
better: they read as considered rather than as broken.

### Client-side polygon clipping

Fetch each candidate district's geometry, clip it against the parcel and report the actual
intersection area. It would answer the question this ADR declines to answer — how much of the
property each district covers.

Rejected on cost and on risk. It needs district geometry per lookup — a 75-acre district carries a
27,520-foot boundary — and roughly 400 lines of robust polygon clipping written from scratch in a
page that may not take a dependency. Every published proportion would then rest on that code being
correct on holes, self-touching rings and coordinate precision. The honest answer to "how much" is
that the lookup does not measure it, and saying so costs nothing.

### The ArcGIS geometry service

Send the parcel and the candidates to a geometry service and read back the relationship or the
intersection.

Rejected because it adds a host: a `connect-src` edit in both `public/_headers` and
`public/staticwebapp.config.json`, a new row in `DATA-SOURCES.md`, and a new external dependency for
a resident-facing answer. Several of its operations are token-gated, and this page holds no
credential and must not start.

### `relationParam` (`esriSpatialRelRelation`)

Express the relationship as a DE-9IM string in one query per layer.

Rejected: it is documented as unsupported on hosted feature services, and it would not have removed
interior overlaps anyway.

## Consequences

### Positive

- Parcels in a gap in the zoning map get an explanation instead of a false negative, and parcels the
  map splits get every district it draws on them.
- Every state has one explicit sentence, so a staff member reading the page aloud says the same thing
  the page says.
- The unconfirmed touch is a first-class answer. The map's own ambiguity reaches the reader instead
  of being resolved silently in the page's favour.
- The behaviour is pinned against real parcels by four live contracts, so a change at the source
  fails a check rather than changing what residents are told.

### Negative

- Six more service requests per lookup. `maxConcurrent` stays 12 and the measured burst is unchanged,
  but it is real load on a public service.
- More residents now see a sentence that ends in a phone number. That is the point — the ambiguity is
  in the map, and Planning and Zoning is where it gets resolved — but it is more calls.
- The probe geometry exists in two copies, in the page and in `scripts/service-contract-core.mjs`,
  because a self-contained page cannot import a module. A unit test compares them character for
  character, the same discipline ADR-0001 accepted for the shared request layer.

### Governance

- No proportion, percentage or size may be published by these layers. Probes prove presence; nothing
  measures extent. A future change that starts measuring extent needs its own decision record.
- No coverage layer may render "Not in this area", and no unconfirmed candidate may be suppressed.
  Both are asserted by tests rather than left to review.

## References

- `docs/changes/CHANGES-2026-09-10.md` §6 — the two parcels, the live measurements and the sentences
- `CODE.md` §6, "Coverage layers answer from the whole parcel"
- `USAGE.md` — "Coverage layers", for GIS staff, and the resident-facing table of what each answer means
- `DATA-SOURCES.md` — Method column for the three layers
- [ADR-0001](0001-use-vite-with-build-time-configuration.md) — the self-contained-page constraint and
  the duplicate-by-necessity discipline
