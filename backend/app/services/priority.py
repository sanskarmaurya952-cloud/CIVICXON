"""CIVICXON Dynamic Priority Scoring Engine.

PRD Page 16 Specification:
Deterministic, explainable backend formula calculating a priority score from 0 to 100
for every master issue.

Configurable Weights:
1. Issue severity and safety risk: 25% (0.25)
2. Road/location importance: 20% (0.20)
3. Traffic and heavy-vehicle activity: 15% (0.15)
4. Junction/chowraha proximity: 10% (0.10)
5. Critical public-service & accessibility impact: 10% (0.10)
6. Citizen report count: 10% (0.10)
7. Issue age and deadline delay: 10% (0.10)

Priority Bands:
- 80-100: CRITICAL
- 60-79:  HIGH
- 40-59:  MEDIUM
- 0-39:   LOW

The score is calculated using deterministic logic with full factor provenance.
Gemma 4 assists with visible damage analysis; the backend formula calculates the score.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional
import math


DEFAULT_WEIGHTS = {
    "severity": 0.25,
    "road_importance": 0.20,
    "traffic_activity": 0.15,
    "junction_proximity": 0.10,
    "public_service_impact": 0.10,
    "report_count": 0.10,
    "issue_age_delay": 0.10,
}

SLA_HOURS = {
    "pothole": 48.0,      # 48 hour SLA
    "streetlight": 72.0,  # 72 hour SLA
}

FORMULA_VERSION = "2.0-prd"


def calculate_severity_factor(severity_label: str) -> tuple[float, str]:
    """Calculate 0-100 severity factor from category/AI severity label."""
    s = (severity_label or "").strip().lower()
    if s == "critical":
        return 100.0, "Critical structural hazard or high danger"
    elif s in ("severe", "high"):
        return 75.0, "Severe hazard in active transit space"
    elif s in ("moderate", "medium"):
        return 50.0, "Moderate issue requiring planned repair"
    elif s in ("low", "minor"):
        return 25.0, "Minor defect with minimal safety risk"
    return 50.0, "Default moderate assessment"


def calculate_road_importance(address: str, zone: str) -> tuple[float, str]:
    """Deterministic score based on road classification keywords or verified GIS."""
    text = f"{address} {zone}".lower()
    if any(k in text for k in ["highway", "expressway", "ring road", "flyover", "arterial", "100 feet", "outer ring"]):
        return 100.0, "Major arterial highway / express corridor"
    elif any(k in text for k in ["main road", "mg road", "brigade", "commercial", "avenue", "junction", "circle"]):
        return 75.0, "Primary city transit corridor"
    elif any(k in text for k in ["cross", "layout", "sector", "stage", "block"]):
        return 50.0, "Secondary collector / neighborhood road"
    return 30.0, "Local residential lane"


def calculate_traffic_activity(address: str, zone: str) -> tuple[float, str]:
    """Deterministic traffic and heavy-vehicle activity score."""
    text = f"{address} {zone}".lower()
    if any(k in text for k in ["bus lane", "bus route", "truck", "commercial", "depot", "freight", "station"]):
        return 100.0, "Heavy commercial / bus route activity"
    elif any(k in text for k in ["central", "market", "main", "plaza"]):
        return 70.0, "High volume mixed vehicular traffic"
    elif any(k in text for k in ["residential", "colony", "enclave"]):
        return 25.0, "Low-speed residential traffic"
    return 40.0, "Standard municipal traffic flow"


def calculate_junction_proximity(address: str, lat: float, lng: float) -> tuple[float, str]:
    """Proximity to major intersections / chowraha."""
    text = (address or "").lower()
    if any(k in text for k in ["signal", "junction", "chowraha", "crossroad", "circle", "intersection", "roundabout"]):
        return 100.0, "Directly at major intersection/chowraha (< 50m)"
    elif any(k in text for k in ["near signal", "near junction", "turning", "corner"]):
        return 65.0, "Near junction approach zone (50m-150m)"
    return 20.0, "Mid-block road segment (> 150m from junction)"


def calculate_public_service_impact(address: str, description: str) -> tuple[float, str]:
    """Proximity to critical public facilities (hospitals, schools, metro, fire stations)."""
    text = f"{address} {description}".lower()
    if any(k in text for k in ["hospital", "clinic", "trauma", "ambulance", "emergency"]):
        return 100.0, "Emergency / Hospital corridor impact"
    elif any(k in text for k in ["school", "college", "university", "kindergarten"]):
        return 85.0, "School zone / pedestrian safety corridor"
    elif any(k in text for k in ["metro", "railway", "train", "bus terminal", "transit"]):
        return 75.0, "High-density public transit hub proximity"
    return 25.0, "Standard civic zone impact"


def calculate_report_count_factor(report_count: int) -> tuple[float, str]:
    """Multiple citizen complaints indicate community impact and persistent defect."""
    count = max(1, int(report_count or 1))
    if count >= 6:
        return 100.0, f"High urgency: {count} verified citizen reports linked"
    elif count >= 4:
        return 80.0, f"{count} verified citizen reports linked"
    elif count >= 2:
        return 55.0, f"{count} verified citizen reports linked"
    return 25.0, "Single citizen report"


def calculate_issue_age_delay(created_at: datetime, category: str, now: Optional[datetime] = None) -> tuple[float, str]:
    """Calculates age against SLA delay."""
    now = now or datetime.utcnow()
    sla = SLA_HOURS.get(category.lower() if category else "pothole", 48.0)
    age_hours = max(0.0, (now - created_at).total_seconds() / 3600.0)

    # Ratio of age to SLA
    ratio = age_hours / sla
    if ratio >= 2.0:  # 2x overdue
        score = 100.0
        desc = f"Severely overdue ({age_hours:.1f}h open vs {sla:.0f}h SLA)"
    elif ratio >= 1.0: # Overdue
        score = min(95.0, 75.0 + (ratio - 1.0) * 20.0)
        desc = f"Overdue ({age_hours:.1f}h open vs {sla:.0f}h SLA)"
    else:
        score = max(5.0, ratio * 70.0)
        desc = f"Within SLA ({age_hours:.1f}h open of {sla:.0f}h target)"
    return round(score, 1), desc


def get_priority_band(score: float) -> str:
    """Map 0-100 score to PRD priority band."""
    if score >= 80.0:
        return "CRITICAL"
    elif score >= 60.0:
        return "HIGH"
    elif score >= 40.0:
        return "MEDIUM"
    return "LOW"


def calculate_priority_score(
    category: str,
    severity: str,
    address: str,
    zone: str,
    lat: float,
    lng: float,
    description: str,
    report_count: int = 1,
    created_at: Optional[datetime] = None,
    custom_weights: Optional[Dict[str, float]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Calculate the comprehensive explainable dynamic priority score."""
    weights = custom_weights or DEFAULT_WEIGHTS
    created_at = created_at or datetime.utcnow()
    now = now or datetime.utcnow()

    sev_score, sev_src = calculate_severity_factor(severity)
    road_score, road_src = calculate_road_importance(address, zone)
    traffic_score, traffic_src = calculate_traffic_activity(address, zone)
    junc_score, junc_src = calculate_junction_proximity(address, lat, lng)
    pub_score, pub_src = calculate_public_service_impact(address, description)
    rep_score, rep_src = calculate_report_count_factor(report_count)
    age_score, age_src = calculate_issue_age_delay(created_at, category, now)

    total_weight = sum(weights.values()) or 1.0

    factors = {
        "severity": {
            "value": round(sev_score, 1),
            "weight": weights["severity"],
            "weighted": round((weights["severity"] / total_weight) * sev_score, 2),
            "source": sev_src,
        },
        "road_importance": {
            "value": round(road_score, 1),
            "weight": weights["road_importance"],
            "weighted": round((weights["road_importance"] / total_weight) * road_score, 2),
            "source": road_src,
        },
        "traffic_activity": {
            "value": round(traffic_score, 1),
            "weight": weights["traffic_activity"],
            "weighted": round((weights["traffic_activity"] / total_weight) * traffic_score, 2),
            "source": traffic_src,
        },
        "junction_proximity": {
            "value": round(junc_score, 1),
            "weight": weights["junction_proximity"],
            "weighted": round((weights["junction_proximity"] / total_weight) * junc_score, 2),
            "source": junc_src,
        },
        "public_service_impact": {
            "value": round(pub_score, 1),
            "weight": weights["public_service_impact"],
            "weighted": round((weights["public_service_impact"] / total_weight) * pub_score, 2),
            "source": pub_src,
        },
        "report_count": {
            "value": round(rep_score, 1),
            "weight": weights["report_count"],
            "weighted": round((weights["report_count"] / total_weight) * rep_score, 2),
            "source": rep_src,
        },
        "issue_age_delay": {
            "value": round(age_score, 1),
            "weight": weights["issue_age_delay"],
            "weighted": round((weights["issue_age_delay"] / total_weight) * age_score, 2),
            "source": age_src,
        },
    }

    raw_score = sum(f["weighted"] for f in factors.values())
    final_score = round(max(0.0, min(100.0, raw_score)), 1)
    band = get_priority_band(final_score)

    # Explanation summary
    top_factor = max(factors.items(), key=lambda x: x[1]["weighted"])
    explanation = f"Score {final_score:.1f} ({band}) — highest contributor: {top_factor[0].replace('_', ' ')} ({top_factor[1]['weighted']:.1f} pts). {top_factor[1]['source']}."

    return {
        "score": final_score,
        "band": band,
        "explanation": explanation,
        "factors": factors,
        "formula_version": FORMULA_VERSION,
        "calculated_at": now.isoformat(),
    }
