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
| Base zoning | `zoneupdate2024/0` | Parcel-centroid intersection | Millcreek Planning and GIS | Verify after every zoning-map amendment |
| Future land use | `Future_Land_Use_2019/0` | Parcel-centroid intersection | Millcreek Planning and GIS | Verify against the adopted General Plan |
| Historic designation | `HistoricDistricts/0` | Full-parcel intersection; reports `designation_type`, `local_ordinance`, and `listyear` | Millcreek Planning and GIS | Annual and after district changes; preserve Federal versus Federal-and-Local distinction |
| City Center Overlay | `Zone_TCOZ/0` | Parcel-centroid intersection | Millcreek Planning and GIS | Verify after overlay amendments |
| 2026 Wildland-Urban Interface | `Millcreek_Wildland_Urban_Interface_WUI_Boundary_–_2026/0` | Full-parcel intersection | Millcreek Fire, Planning and GIS | Confirm after boundary or state-law changes |
| Sensitive Land Area | `Sensitive_Land_Areas__Feb24/0` | Full-parcel intersection | Millcreek Planning and GIS | Confirm after regulatory boundary changes |
| Subdivision and plat | `Subdivision_Dissovle_3/7` | Centroid intersection plus feature attachments | Millcreek GIS | Schema and attachment sample weekly |
| FEMA flood detail | `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28` | Live full-parcel intersection; displays all matches and selects the highest classification by documented conservative precedence | Federal Emergency Management Agency | Live contract check; review display precedence after FEMA schema or terminology changes |
| Quaternary fault proximity | `https://webmaps.geology.utah.gov/arcgis/rest/services/Hazards/Faults_Quaternary/MapServer/2` | Live full-parcel query with a 1,000-foot search distance; not a local special-study-area determination | Utah Geological Survey | Live contract check and review after UGS revisions |
| City Council | `Millcreek_City_Council_Dist_2022/2` | Parcel-centroid intersection | Millcreek GIS | Verify after annexation or redistricting |
| Waste collection | `TrashPickupDays/0` | Parcel-centroid intersection | Wasatch Front Waste & Recycling District; Millcreek GIS service steward | Confirm route/provider updates |
| Sewer | `SewerDistrictsUpdated/0` | Parcel-centroid intersection | Utility providers; Millcreek GIS service steward | Confirm provider boundary updates |
| Culinary water | `Water_Services_2021/3` | Parcel-centroid intersection; expected one provider | Utah Division of Drinking Water and providers | Review gaps and overlaps at every update |
| Electrical | `Electrical_Service/0` | Parcel-centroid intersection | Utility providers; Millcreek GIS service steward | Confirm provider boundary updates |

All configured endpoints and fields passed the live schema contract check on 9 August 2026. This
does not establish that an older-named dataset is still the adopted source.

## Replacement candidates requiring approval

| Current source | Candidate | Required validation before switching |
|:--|:--|:--|
| `Future_Land_Use_2019/0` | `FutureLandUse_2024_Millcreek/0` | Planning confirms the adopted plan; compare designations, coverage, domains and document URLs for all changed polygons |
| `zoneupdate2024/0` | `Zone_Update_2025___Related_Master/2` | Planning confirms it is the public zoning source; compare codes, descriptions, ordinance links, gaps, overlaps and known amendment parcels |

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
