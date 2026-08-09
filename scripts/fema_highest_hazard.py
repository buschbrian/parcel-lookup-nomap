"""Query FEMA NFHL flood zones for a Millcreek parcel with ArcGIS API for Python.

The selected result uses the same conservative display precedence as index.html.
It is not a FEMA risk score or a regulatory flood determination. Every intersecting
classification is preserved in the JSON output for review.
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Iterable

PARCEL_LAYER_URL = (
    "https://services9.arcgis.com/XRrSFvEwSsReIxuA/arcgis/rest/services/"
    "Millcreek_Parcels/FeatureServer/0"
)
FEMA_FLOOD_LAYER_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
)
MILLCREEK_FLOOD_LAYER_URL = (
    "https://services9.arcgis.com/XRrSFvEwSsReIxuA/arcgis/rest/services/"
    "Flood_Hazard_Zones_Final_Update/FeatureServer/0"
)
FEMA_FIELDS = "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,LEN_UNIT,SOURCE_CIT"


def flood_rank(attributes: dict[str, Any]) -> int:
    """Return the application's conservative display precedence."""
    zone = str(attributes.get("FLD_ZONE") or "").strip().upper()
    subtype = str(attributes.get("ZONE_SUBTY") or "").strip().upper()
    if "FLOODWAY" in subtype:
        return 1200
    zone_order = {
        "VE": 1100,
        "V": 1080,
        "AE": 1040,
        "AH": 1020,
        "AO": 1010,
        "A": 1000,
        "A99": 990,
        "AR": 980,
    }
    if zone in zone_order:
        return zone_order[zone]
    if str(attributes.get("SFHA_TF") or "").upper() == "T":
        return 950
    if "1 PCT" in subtype:
        return 800
    if "0.2 PCT" in subtype:
        return 600
    if "REDUCED FLOOD RISK" in subtype:
        return 500
    if zone == "D":
        return 300
    if "MINIMAL FLOOD HAZARD" in subtype:
        return 100
    return 0


def select_highest(features: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    """Choose one classification deterministically while retaining the input."""
    rows = list(features)
    if not rows:
        return None
    return sorted(
        rows,
        key=lambda row: (-flood_rank(row), str(row.get("FLD_ZONE") or "")),
    )[0]


def flood_signature(attributes: dict[str, Any]) -> str:
    zone = str(attributes.get("FLD_ZONE") or "").strip().upper()
    subtype = " ".join(
        str(attributes.get("ZONE_SUBTY") or "").strip().upper().replace("PERCENT", "PCT").split()
    )
    sfha = str(attributes.get("SFHA_TF") or "").strip().upper()
    return f"{zone}|{subtype}|{sfha}"


def comparable_classifications(features: Iterable[dict[str, Any]]) -> set[str]:
    """Normalize labels and omit minimal-X polygons absent from Millcreek's copy."""
    return {
        flood_signature(row)
        for row in features
        if "MINIMAL FLOOD HAZARD" not in str(row.get("ZONE_SUBTY") or "").upper()
    }


def clean_classification(attributes: dict[str, Any]) -> dict[str, Any]:
    """Normalize ArcGIS sentinel elevations before JSON output."""
    result = {field: attributes.get(field) for field in FEMA_FIELDS.split(",")}
    elevation = result.get("STATIC_BFE")
    if isinstance(elevation, (int, float)) and elevation <= -9999:
        result["STATIC_BFE"] = None
    return result


def query_parcel(parcel_id: str) -> dict[str, Any]:
    """Run the full-parcel spatial query. ArcGIS imports stay optional for tests."""
    try:
        from arcgis.features import FeatureLayer
        from arcgis.geometry.filters import intersects
    except ImportError as error:
        raise SystemExit(
            "ArcGIS API for Python is required. Run this in ArcGIS Pro/Online Notebook "
            "or install the 'arcgis' package in a compatible Python environment."
        ) from error

    escaped = parcel_id.replace("'", "''")
    parcels = FeatureLayer(PARCEL_LAYER_URL).query(
        where=f"parcel_id='{escaped}'",
        out_fields="parcel_id,prop_location",
        return_geometry=True,
        out_sr=4326,
    )
    if not parcels.features:
        raise SystemExit(f"Parcel not found: {parcel_id}")

    parcel = parcels.features[0]
    flood_features = FeatureLayer(FEMA_FLOOD_LAYER_URL).query(
        where="1=1",
        geometry_filter=intersects(parcel.geometry, sr=4326),
        out_fields=FEMA_FIELDS,
        return_geometry=False,
    ).features
    millcreek_features = FeatureLayer(MILLCREEK_FLOOD_LAYER_URL).query(
        where="1=1",
        geometry_filter=intersects(parcel.geometry, sr=4326),
        out_fields=FEMA_FIELDS,
        return_geometry=False,
    ).features
    classifications = [clean_classification(feature.attributes) for feature in flood_features]
    millcreek_classifications = [
        clean_classification(feature.attributes) for feature in millcreek_features
    ]
    classifications.sort(
        key=lambda row: (-flood_rank(row), str(row.get("FLD_ZONE") or ""))
    )
    return {
        "parcel_id": parcel.attributes.get("parcel_id", parcel_id),
        "property_address": parcel.attributes.get("prop_location"),
        "source": FEMA_FLOOD_LAYER_URL,
        "cross_check_source": MILLCREEK_FLOOD_LAYER_URL,
        "selection_method": "conservative display precedence; not a FEMA risk score",
        "highest_classification": select_highest(classifications),
        "all_intersecting_classifications": classifications,
        "millcreek_intersecting_classifications": millcreek_classifications,
        "millcreek_matches_live_fema": comparable_classifications(classifications)
        == comparable_classifications(millcreek_classifications),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Return the highest displayed FEMA NFHL flood subtype for a parcel."
    )
    parser.add_argument("parcel_id", help="Millcreek parcel identifier")
    args = parser.parse_args()
    print(json.dumps(query_parcel(args.parcel_id), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
