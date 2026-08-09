# Public Web Map Parity and Source Review

Review date: **9 August 2026**

Reference application: <https://maps.millcreekut.gov/>

Reference web map: `Planning Experience Web Map`, ArcGIS item
`f780892acd744d0da60001644cada75c` in `millcrk.maps.arcgis.com`.

The deployed Experience Builder configuration points to that web map. Its current configuration
contains **96 leaf operational layers**. A layer's presence in the map does not by itself make the
layer authoritative: the property lookup should mirror resident-facing determinations from the map
and, where possible, compare local copies with the responsible agency's current service.

## Changes implemented from this review

| Determination | Change | Verification rule |
|:--|:--|:--|
| Zoning | Switched from `zoneupdate2024/0` to the map's `Zone_Update_2025___Related_Master/2` | Live schema, known parcel, and web-map URL parity checks |
| Future land use | Switched from `Future_Land_Use_2019/0` to the map's `FutureLandUse_2024_Millcreek/0` | Live schema, known parcel, and web-map URL parity checks |
| Zoning density | Removed `Res_Max_De` from resident output | Unit assertion prevents the field from returning |
| Surface fault rupture | Replaced the direct fault-trace proximity screen with the map's `Fault_Study_Area/0` special-study-area polygon | Full-parcel intersection; explicit Yes/No |
| Flood hazard | FEMA NFHL remains primary; `Flood_Hazard_Zones_Final_Update/0` is queried invisibly for comparison | Per-parcel classifications are normalized and compared; mismatches are visible |

The special-study-area item is owned by `GISMillcreek`. Its public item description says it was
clipped from Salt Lake County data and updated on 6 January 2026. The result therefore identifies
the regulatory screening polygon used in Millcreek's public map; it is not presented as a direct
UGS fault-trace query or a substitute for a site investigation.

Within the Millcreek municipal boundary, the local and live FEMA layers currently expose the same
non-minimal classification vocabulary:

- A, AE, AE Floodway, AH and AO;
- X — 0.2 percent annual chance flood hazard;
- X — 1 percent depth less than 1 foot.

FEMA also returns `X — AREA OF MINIMAL FLOOD HAZARD`; Millcreek's map layer currently has no
corresponding minimal-X polygons. The comparison treats that omission as congruent while still
flagging differences in every other zone/subtype/SFHA combination.

## Complete map inventory and disposition

### Already represented or used for verification

- Millcreek Municipal Boundary — useful for scope/audit queries; the address/parcel services
  already constrain public lookup results.
- Millcreek Wildland Urban Interface — 2026 Update.
- Planning and Zoning: CCOZ, Historic Districts, Subdivisions, Future Land Use and Zoning.
- Geologic: Sensitive Land Areas and Surface Fault Rupture Special Study Area.
- Hydrology: Flood Hazard Zones, used as the FEMA cross-check.
- Service Districts: Electrical, Sewer, Garbage Collection and Culinary Water.
- Administrative Boundaries: City Council Districts.
- Millcreek Parcels and Address Points.

These local layer URLs are checked against the web-map item during `npm run check:services`; a map
source change now fails the contract check instead of silently drifting from the reference map.

### High-priority candidates for the text lookup

| Public-map layer | Resident value | Source work required before implementation |
|:--|:--|:--|
| Liquefaction Potential | Direct geologic-hazard screening | Confirm the adopted special-study/risk interpretation with Planning and compare with current UGS/County data |
| Debris Flow; Alluvial Fans | Development hazard screening | Determine whether the polygons are hazard inventories or regulatory special-study areas; prefer current UGS/County sources |
| Streams — 200 ft Buffer | Sensitive-land/project review | Confirm the applicable ordinance and whether whole-parcel intersection is the correct public answer |
| National Wetlands Inventory | Wetland screening | Compare the local copy with the current U.S. Fish and Wildlife Service source and explain that mapped wetlands are not a jurisdictional determination |
| Natural Gas Service Areas | Missing utility provider | Confirm provider stewardship, contact fields, gaps and overlaps |
| Historic Buildings; Monuments and Markers | Completes historic-property context beyond districts | Distinguish local designation, National Register status and inventory-only records |
| Active Short-Term Rentals and 400-foot buffers | Current regulatory proximity | Confirm public-disclosure policy, update cadence and whether an address-level result is appropriate |
| School, state, federal and county districts | Broader representation | Prefer the responsible district/state/county sources and add only fields that residents can act on |
| Code Compliance Officer Boundaries | Department routing | Confirm that staff assignments are intended for public display and kept current |

### Reference layers not recommended as parcel determinations

- Transportation: ten Granite School District safe-route layers, County road centerlines, roadway
  functional class, pavement buffer, UTA routes and UTA stops.
- Tree canopy extracted from 2024 LiDAR and June 2024 OSM building footprints.
- Terrain aspect and the two 2024 LiDAR slope tile layers.
- Sugarhouse geologic units and geologic lines.
- Hydrologic reference/asset layers: subcatchments, watersheds, historic floodplain, base flood
  elevation lines, current/historical irrigation, NHD sinks/waterbodies/flowlines, surveyed storm
  drain pipes, and the twelve stormwater-system asset layers.
- Historical zoning tiles from 1979, 1988, 1990, 1993 and 2004.
- Cell towers and local parks, unless a future service requirement calls for them.
- ZIP codes and map-only road labels.

These remain useful in the interactive map for visual analysis, infrastructure work or historical
reference, but they do not yet have a clear address-level determination that improves this service.

### Explicitly excluded or deprecated

- Firework Restrictions — seasonal and previously produced irrelevant contact attributes in the
  text lookup. Reconsider only as a purpose-built seasonal answer with a verified current source.
- Deprecated 2022–2026 congressional, community-council and 2016–2022 City Council boundaries.
- Quaternary fault traces as a substitute for the surface-fault-rupture special-study area. Fault
  traces may remain a map reference, but they do not answer the regulatory question requested here.

## Governance recommendations

1. Treat the public web map as the parity reference for which local products residents can see, not
   as proof of authority.
2. Record an agency/steward, source URL, interpretation and review date before adding any result.
3. Use full-parcel geometry for regulatory and hazard polygons; use a parcel point only when one
   mutually exclusive provider/district is expected.
4. Where a local copy mirrors FEMA, UGS, USFWS, UTA or another agency, query both where practical
   and make disagreement visible.
5. Add high-priority layers incrementally, with a known positive parcel, a known negative parcel,
   boundary cases, accessibility coverage and live service-contract checks.
6. Review the 96-layer inventory after material web-map changes and at least annually.
