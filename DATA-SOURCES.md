# Data Source Register

Last repository review: **9 August 2026**.

This is the maintenance register for every public determination. A service name or year is not proof
that it is authoritative. GIS must confirm proposed replacements with the named owner, compare
coverage and results, update `CFG`, this register and tests together, and record the approval.

## Current production sources

| Result | Current service/layer | Method | Source owner or steward | Review expectation |
|:--|:--|:--|:--|:--|
| Address to parcel | `Address_Points/0` | Attribute search; returns `ParcelID` | Millcreek GIS; UGRC and Salt Lake County origins | Schema and known-address check weekly |
| Parcel facts and geometry | `Millcreek_Parcels/0` | Whole parcel record and boundary; stored point for point-based lookups | Millcreek GIS; Salt Lake County parcel origins | Confirm refresh at every parcel update |
| Base zoning | `Zone_Update_2025___Related_Master/2` | Parcel-centroid intersection | Millcreek Planning and GIS; source used by public Planning web map | Verify after every zoning-map amendment and against web-map parity check |
| Future land use | `FutureLandUse_2024_Millcreek/0` | Parcel-centroid intersection | Millcreek Planning and GIS; source used by public Planning web map | Verify against the adopted General Plan and web-map parity check |
| Historic designation | `HistoricDistricts/0` | Full-parcel intersection; reports `designation_type`, `local_ordinance`, and `listyear` | Millcreek Planning and GIS | Annual and after district changes; preserve Federal versus Federal-and-Local distinction |
| City Center Overlay | `Zone_TCOZ/0` | Parcel-centroid intersection | Millcreek Planning and GIS | Verify after overlay amendments |
| 2026 Wildland-Urban Interface | `Millcreek_Wildland_Urban_Interface_WUI_Boundary_–_2026/0` | Full-parcel intersection | Millcreek Fire, Planning and GIS | Confirm after boundary or state-law changes |
| Sensitive Land Area | `Sensitive_Land_Areas__Feb24/0` | Full-parcel intersection | Millcreek Planning and GIS | Confirm after regulatory boundary changes |
| Subdivision and plat | `Subdivision_Dissovle_3/7` | Centroid intersection plus feature attachments | Millcreek GIS | Schema and attachment sample weekly |
| FEMA flood detail | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | Live full-parcel intersection; displays all matches and selects the highest classification by documented conservative precedence | Federal Emergency Management Agency | Live contract check; review display precedence after FEMA schema or terminology changes |
| FEMA flood cross-check | `Flood_Hazard_Zones_Final_Update/0` | Hidden full-parcel comparison with live FEMA; minimal-X omission is normalized | FEMA data published in Millcreek's public Planning web map | Surface mismatches and run known-parcel plus web-map parity checks |
| Surface fault rupture special-study area | `Fault_Study_Area/0` | Full-parcel Yes/No intersection | Salt Lake County data clipped/published by Millcreek; public item updated 6 January 2026 | Confirm continued use in the public Planning map and review after County/UGS mapping changes |
| Liquefaction potential | `LiquefactionPotential/0` | Full-parcel intersection; if categories overlap, displays the highest configured category | UGS/UGRC digitization published by Millcreek; service description traces the mapping to 1994 UGS contract reports | Informational only; compare with a current authoritative UGS source before any authoritative use |
| Debris-flow screening | `DebrisFlow_WasatchFront_ClipBuffer/0` | Full-parcel Yes/No intersection | Millcreek-published debris study-area item; no external steward is identified in its metadata | Informational only; do not infer an ordinance or study requirement from the source field; find a current authoritative replacement |
| Alluvial-fan deposits | `AlluvialFans/0` | Full-parcel Yes/No intersection | Millcreek-published geologic item; no external steward is identified in its metadata | Informational geologic context; do not treat as a parcel-scale hazard determination; find a current authoritative replacement |
| Published short-term-rental parcel | `Short_Term_Rentals_June_2026/0` | Exact parcel-ID match on the separate licensing page | Millcreek Business Licensing data published by Millcreek GIS | Dated June 2026 snapshot; confirm current license status with Business Licensing |
| Published short-term-rental buffer | `Short_Term_Rentals_June_2026/1` | Full-parcel intersection; excludes the selected parcel's own buffer by `parcel_id` | Millcreek Business Licensing data published by Millcreek GIS | Verify the geometry remains 400 feet, snapshot date, renewals and source cadence before licensing use; `BUFF_DIST` currently stores 121.92024384 (400 feet in metres) despite a feet alias |
| City Council | `Millcreek_City_Council_Dist_2022/2` | Parcel-centroid intersection | Millcreek GIS | Verify after annexation or redistricting |
| Waste collection | `TrashPickupDays/0` | Parcel-centroid intersection | Wasatch Front Waste & Recycling District; Millcreek GIS service steward | Confirm route/provider updates |
| Sewer | `SewerDistrictsUpdated/0` | Parcel-centroid intersection | Utility providers; Millcreek GIS service steward | Confirm provider boundary updates |
| Culinary water | `Water_Services_2021/3` | Parcel-centroid intersection; expected one provider | Utah Division of Drinking Water and providers | Review gaps and overlaps at every update |
| Electrical | `Electrical_Service/0` | Parcel-centroid intersection | Utility providers; Millcreek GIS service steward | Confirm provider boundary updates |

All configured endpoints and fields passed the live schema contract check on 9 August 2026. Local
source URLs used by this lookup are also checked against the public Planning web-map item.

## ArcGIS Online and Enterprise metadata expectations

The repository register supplements portal metadata; it does not replace it. Each ArcGIS item and
resident-facing sublayer should let a reviewer establish:

- the municipal data owner and technical item owner;
- whether the product is authoritative, informational, or derived;
- the original county, state, federal, or municipal source, including a stable upstream URL;
- the derivation or publication method for any clipped, buffered, joined, generalized, or otherwise
  transformed product;
- source, publication, last-reviewed, and expected-refresh dates;
- acknowledgements/credits, terms of use, license or access constraints, and a contact;
- intended scale or limitations, spatial reference, extent, fields, domains, and known quality
  constraints.

These details belong in ArcGIS item details and, where available, standards-based layer metadata.
Item-level and layer-level metadata must both be reviewed because they are not automatically kept
in sync. A locally published copy of county, state, or federal data must name its upstream source;
the Millcreek publisher account alone is not sufficient provenance.

ArcGIS API for Python may be used to search ArcGIS Online and Enterprise, export these facts, and
produce a metadata-gap report. Treat the report as release evidence. The tool must not update item
details, sharing, services, or data unless an authenticated operator explicitly invokes a separate
reviewed maintenance operation.

## Public-map alignments adopted in this review

- `Future_Land_Use_2019/0` → `FutureLandUse_2024_Millcreek/0`.
- `zoneupdate2024/0` → `Zone_Update_2025___Related_Master/2`.
- Direct UGS fault-trace proximity → `Fault_Study_Area/0` surface-fault-rupture
  special-study-area determination.
- Added liquefaction, debris-flow and alluvial-fan layers as a separate informational,
  non-regulatory group.
- Added a separate Business Licensing lookup for the published STR parcels and 400-foot buffers;
  no owner or mailing-address attributes are exposed.

See [WEB-MAP-REVIEW.md](WEB-MAP-REVIEW.md) for the complete 96-layer inventory, implemented
parity decisions and prioritized candidates.

Do **not** migrate to `CityCouncilDistricts/0` based on its shorter name: its published layer name
describes 2017–2022 boundaries. The configured council service was edited in 2026 and remains in
place until GIS certifies a replacement.

## Migration acceptance record

For an approved source change, record in the pull request and this file:

1. approver, department and approval date;
2. old and new item/layer URLs and service metadata dates;
3. field/domain mapping and any changed public wording;
4. counts of gaps, overlaps and changed parcel outcomes;
5. known-address comparisons, including boundary parcels;
6. updated `reviewedOn` and `CFG.release.dataReviewedOn` dates;
7. passing `npm test`, `npm run check:services`, manual accessibility checks and post-deploy check.

**Post-deploy check, as of 13 August 2026.** `npm run check:deployment` fails on its HTML byte
comparison for a hosting reason rather than a deployment fault, and aborts before its header and
allowlist assertions run — so it cannot currently satisfy item 7 on its own. Verify the security
headers and publish allowlist by hand until it is repaired. See CHANGES-2026-08-13.md §7.

**Review record, 13 August 2026.** `npm run check:services` passed 51/51 against live services: all 22
configured endpoints, both known-parcel lookups, 21 spatial queries, FEMA/Millcreek flood congruence
including the known hazard parcel, the two historic designation types, the STR parcel and 400-foot
buffer, and parity with the public Planning web map across 21 adopted local layers. No source URL,
field or domain changed; this substantiates `CFG.release.dataReviewedOn = 2026-08-13` rather than
recording a migration.
