"""Smart worker allocation — deterministic, auditable, race-safe.

Eligibility: active account + exact skill match + availability not in
(OFFLINE, ON_LEAVE) + load < max_concurrent_jobs + issue zone covered.
Ranking: configurable weights over skill / distance / workload / availability.

Concurrency: assignment runs inside a transaction with SELECT ... FOR UPDATE
on the candidate rows, so two admins (or auto+manual) cannot double-book a
worker past capacity.
"""
import json
from math import radians, sin, cos, asin, sqrt
from typing import List, Tuple
from sqlalchemy import text
from sqlalchemy.orm import Session
from .. import models
from ..config import settings


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(a))


def _distance_score(km: float, max_km: float = 15.0) -> float:
    if km <= 0.5:
        return 1.0
    if km >= max_km:
        return 0.05
    return max(0.05, 1 - km / max_km)


def _workload_score(load: int, cap: int) -> float:
    return max(0.0, 1 - load / max(1, cap))


def _availability_score(a: str) -> float:
    return {"AVAILABLE": 1.0, "BUSY": 0.35}.get(a, 0.0)


SKILL_FOR = {"pothole": "road_maintenance", "streetlight": "streetlight_maintenance"}


def rank_workers(db: Session, issue: models.Issue, weights: dict | None = None):
    weights = weights or json.loads(settings.ALLOCATION_WEIGHTS)
    required_skill = SKILL_FOR[issue.category.value]
    total = max(0.0001, sum(weights.values()))

    # issue coordinates
    lat, lng = db.execute(text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM issues WHERE id=:i"), {"i": issue.id}).one()

    rows = (
        db.query(models.WorkerProfile, models.User)
        .join(models.User, models.User.id == models.WorkerProfile.user_id)
        .with_for_update(of=models.WorkerProfile, skip_locked=False)
        .all()
    )

    ranked = []
    for profile, user in rows:
        base = db.execute(text("SELECT ST_Y(base_location::geometry), ST_X(base_location::geometry) FROM worker_profiles WHERE id=:i"), {"i": profile.id}).one()
        dist_km = haversine_km(lat, lng, base[0], base[1])
        ineligible: List[str] = []
        if not user.active:
            ineligible.append("account deactivated")
        if required_skill not in (profile.skills or []):
            ineligible.append(f"missing skill {required_skill}")
        if profile.availability in ("OFFLINE", "ON_LEAVE"):
            ineligible.append("unavailable")
        if profile.current_load >= profile.max_concurrent_jobs:
            ineligible.append("at capacity")
        if issue.zone not in (profile.zones or []):
            ineligible.append(f"outside zone {issue.zone}")

        skill_s = 100.0 if required_skill in (profile.skills or []) else 0.0
        dist_s = round(_distance_score(dist_km) * 1000) / 10
        work_s = round(_workload_score(profile.current_load, profile.max_concurrent_jobs) * 1000) / 10
        avail_s = round(_availability_score(profile.availability) * 1000) / 10

        score = 0.0
        if not ineligible:
            score = round(
                (weights["skill"] / total) * skill_s
                + (weights["distance"] / total) * dist_s
                + (weights["workload"] / total) * work_s
                + (weights["availability"] / total) * avail_s,
                1,
            )
        reason = (
            f"Ineligible: {'; '.join(ineligible)}"
            if ineligible
            else f"skill {skill_s:.0f} · {dist_km:.1f} km ({dist_s:.0f}) · load {profile.current_load}/{profile.max_concurrent_jobs} ({work_s:.0f}) · {profile.availability.lower()} ({avail_s:.0f}) ⇒ {score:.1f}"
        )
        ranked.append({
            "worker": profile, "user": user, "eligible": not ineligible, "score": score,
            "breakdown": {"skill": skill_s, "distance": dist_s, "workload": work_s, "availability": avail_s, "distance_km": round(dist_km, 2)},
            "reason": reason, "ineligible_reasons": ineligible,
        })

    ranked.sort(key=lambda r: r["score"] if r["eligible"] else -1, reverse=True)
    return ranked


def assign_worker(db: Session, issue: models.Issue, worker: models.WorkerProfile, source: str, actor: models.User | None, note: str | None = None):
    """Assign inside the current transaction. Caller owns db.commit()."""
    required_skill = SKILL_FOR[issue.category.value]
    # Re-validate eligibility *now* — rules decide, never the model
    if required_skill not in (worker.skills or []):
        raise ValueError("worker lacks required skill")
    if worker.availability in ("OFFLINE", "ON_LEAVE"):
        raise ValueError("worker unavailable")
    if worker.current_load >= worker.max_concurrent_jobs:
        raise ValueError("worker at capacity")
    if issue.zone not in (worker.zones or []):
        raise ValueError("worker does not cover this zone")

    db.query(models.Assignment).filter(models.Assignment.issue_id == issue.id, models.Assignment.status == "ACTIVE").update({"status": "SUPERSEDED"})
    weights = json.loads(settings.ALLOCATION_WEIGHTS)
    total = max(0.0001, sum(weights.values()))
    lat, lng = db.execute(text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM issues WHERE id=:i"), {"i": issue.id}).one()
    base = db.execute(text("SELECT ST_Y(base_location::geometry), ST_X(base_location::geometry) FROM worker_profiles WHERE id=:i"), {"i": worker.id}).one()
    dist_km = haversine_km(lat, lng, base[0], base[1])
    dist_s = round(_distance_score(dist_km) * 1000) / 10
    work_s = round(_workload_score(worker.current_load, worker.max_concurrent_jobs) * 1000) / 10
    avail_s = round(_availability_score(worker.availability) * 1000) / 10
    skill_s = 100.0
    score = round((weights["skill"] / total) * skill_s + (weights["distance"] / total) * dist_s + (weights["workload"] / total) * work_s + (weights["availability"] / total) * avail_s, 1)

    assignment = models.Assignment(
        issue_id=issue.id, worker_id=worker.id, score=score,
        breakdown={"skill": skill_s, "distance": dist_s, "workload": work_s, "availability": avail_s, "distance_km": round(dist_km, 2)},
        reason=f"skill {skill_s:.0f} · {dist_km:.1f} km · load {worker.current_load}/{worker.max_concurrent_jobs} · {worker.availability.lower()} ⇒ {score:.1f}" + (f" · note: {note}" if note else ""),
        source=source, created_by=actor.id if actor else None, status="ACTIVE",
    )
    db.add(assignment)

    if issue.status in (models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW, models.IssueStatus.ASSIGNED, models.IssueStatus.REWORK_REQUIRED, models.IssueStatus.IN_PROGRESS):
        issue.status = models.IssueStatus.ASSIGNED
    issue.assigned_worker_id = worker.id
    issue.assigned_at = models.datetime.utcnow()
    issue.department_id = worker.department_id
    issue.updated_at = models.datetime.utcnow()

    worker.current_load += 1
    return assignment
