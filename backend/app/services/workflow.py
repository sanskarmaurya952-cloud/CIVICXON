"""CIVICXON Workflow Engine.

Audit trails, status transitions, explainable duplicate candidate detection,
citizen report linking (ONE PHYSICAL DEFECT = ONE MASTER ISSUE),
and priority recalculation.
"""
from datetime import datetime
import re
from math import radians, sin, cos, asin, sqrt
from sqlalchemy.orm import Session
from .. import models
from .priority import calculate_priority_score


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * r * asin(sqrt(max(0.0, min(1.0, a))))


def add_event(db: Session, issue: models.Issue, actor, type_: str, message: str, meta: dict | None = None):
    actor_id, actor_name, actor_role = None, "CivicXon System", "system"
    if actor is not None:
        actor_id = getattr(actor, "id", None)
        actor_name = getattr(actor, "name", "CivicXon System")
        role = getattr(actor, "role", "system")
        actor_role = role.value if hasattr(role, "value") else str(role)
    db.add(models.IssueEvent(
        issue_id=issue.id,
        actor_id=actor_id,
        actor_name=actor_name,
        actor_role=actor_role,
        type=type_,
        message=message,
        meta=meta,
    ))


def log_audit(db: Session, action: str, actor, target_type: str, target_id: int | None, details: dict | None = None):
    actor_id, actor_name, actor_role = None, "CivicXon System", "system"
    if actor is not None:
        actor_id = getattr(actor, "id", None)
        actor_name = getattr(actor, "name", "CivicXon System")
        role = getattr(actor, "role", "system")
        actor_role = role.value if hasattr(role, "value") else str(role)
    log_entry = models.AuditLog(
        action=action,
        actor_id=actor_id,
        actor_name=actor_name,
        actor_role=actor_role,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    )
    db.add(log_entry)


def notify(db: Session, user_id: int, title: str, body: str, type_: str = "GENERAL", link: str | None = None):
    db.add(models.Notification(user_id=user_id, title=title, body=body, type=type_, link=link))


def notify_admins(db: Session, title: str, body: str, type_: str = "ADMIN_ALERT", link: str | None = None):
    admins = db.query(models.User).filter(models.User.role == models.Role.admin, models.User.active.is_(True)).all()
    for admin in admins:
        notify(db, admin.id, title, body, type_, link)


def set_status(db: Session, issue: models.Issue, to: models.IssueStatus) -> models.IssueStatus:
    allowed = models.VALID_TRANSITIONS.get(issue.status, set())
    if to not in allowed:
        raise ValueError(f"Invalid status transition {issue.status.value} → {to.value}")
    from_status = issue.status
    issue.status = to
    issue.updated_at = datetime.utcnow()
    if to == models.IssueStatus.IN_PROGRESS and not issue.started_at:
        issue.started_at = datetime.utcnow()
    if to == models.IssueStatus.ASSIGNED and not issue.assigned_at:
        issue.assigned_at = datetime.utcnow()
    if to == models.IssueStatus.VERIFIED:
        issue.verified_at = datetime.utcnow()
        issue.resolved_at = datetime.utcnow()
    return from_status


def text_similarity(a: str, b: str) -> float:
    stop = {"the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "of", "to", "for", "and", "or", "with", "near", "my", "our", "this", "that", "it", "has", "have"}
    tok = lambda s: [t for t in re.findall(r"[a-z]+", (s or "").lower()) if t not in stop and len(t) > 2]
    A, B = set(tok(a)), set(tok(b))
    if not A or not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


def hamming_distance(a: str, b: str) -> int:
    if not a or not b or len(a) != len(b):
        return 999
    try:
        return sum(bin(int(c1, 16) ^ int(c2, 16)).count("1") for c1, c2 in zip(a, b))
    except Exception:
        return 999


def image_similarity(phash1: str | None, phash2: str | None) -> float:
    if not phash1 or not phash2:
        return 0.0
    d = hamming_distance(phash1, phash2)
    if d >= 256:
        return 0.0
    return max(0.0, 1.0 - d / 256.0)


def find_duplicates(
    db: Session,
    category: models.IssueCategory,
    description: str,
    lat: float,
    lng: float,
    phash: str | None = None,
    radius_km: float = 0.35,
    exclude_issue_id: int | None = None,
) -> list[dict]:
    """Finds duplicate candidates using spatial distance, category, text similarity,
    and perceptual image similarity.
    Classifies matches as SAME_ISSUE, POSSIBLE_DUPLICATE, or DISTINCT_ISSUE (PRD Page 8).
    """
    deg_lat = radius_km / 111.32
    deg_lng = radius_km / (111.32 * max(0.2, cos(radians(lat))))

    q = db.query(models.Issue).filter(
        models.Issue.lat.between(lat - deg_lat, lat + deg_lat),
        models.Issue.lng.between(lng - deg_lng, lng + deg_lng),
        models.Issue.status.notin_([models.IssueStatus.DUPLICATE, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED]),
    )
    if exclude_issue_id:
        q = q.filter(models.Issue.id != exclude_issue_id)

    candidates = q.limit(50).all()
    results = []

    for issue in candidates:
        dist_km = haversine_km(lat, lng, issue.lat, issue.lng)
        if dist_km > radius_km:
            continue

        cat_match = (issue.category == category)
        text_sim = text_similarity(description, issue.description)
        proximity = max(0.0, 1.0 - dist_km / radius_km)

        # Retrieve media phash for the existing issue
        first_media = db.query(models.Media).filter(models.Media.issue_id == issue.id, models.Media.type == "BEFORE").first()
        img_sim = image_similarity(phash, first_media.phash if first_media else None)

        # Weighted combination:
        # If category doesn't match, heavily penalize duplicate probability
        if not cat_match:
            combined = 0.15 * proximity + 0.10 * text_sim
        else:
            base = 0.35 + 0.30 * proximity + 0.20 * text_sim
            if phash and first_media and first_media.phash:
                combined = 0.30 + 0.25 * proximity + 0.15 * text_sim + 0.30 * img_sim
            else:
                combined = base

        combined = round(min(1.0, combined), 3)

        # PRD Page 8 classification
        if combined >= 0.80 or (cat_match and dist_km < 0.03 and (img_sim > 0.85 or text_sim > 0.65)):
            classification = "SAME_ISSUE"
        elif combined >= 0.40 or (cat_match and dist_km < 0.12):
            classification = "POSSIBLE_DUPLICATE"
        else:
            classification = "DISTINCT_ISSUE"

        if classification in ("SAME_ISSUE", "POSSIBLE_DUPLICATE"):
            results.append({
                "issue_id": issue.id,
                "ticket_no": issue.ticket_no,
                "distance_km": round(dist_km, 3),
                "distance_m": round(dist_km * 1000, 1),
                "category_match": cat_match,
                "text_similarity": round(text_sim, 3),
                "image_similarity": round(img_sim, 3) if phash else None,
                "combined": combined,
                "classification": classification,
                "description": issue.description,
                "status": issue.status.value,
            })

    results.sort(key=lambda d: d["combined"], reverse=True)
    return results[:5]


def link_citizen_report(
    db: Session,
    master_issue: models.Issue,
    reporter: models.User,
    description: str,
    lat: float,
    lng: float,
    address: str,
    photo_key: str | None = None,
    phash: str | None = None,
) -> models.CitizenReport:
    """PRD Core Rule: ONE PHYSICAL DEFECT = ONE MASTER ISSUE.
    Links an additional citizen complaint to an existing master issue, increments report_count,
    recalculates dynamic priority, and creates events.
    """
    report_ticket = f"{master_issue.ticket_no}-R{master_issue.report_count + 1}"
    report = models.CitizenReport(
        issue_id=master_issue.id,
        reporter_id=reporter.id,
        ticket_no=report_ticket,
        description=description.strip(),
        category=master_issue.category,
        lat=lat,
        lng=lng,
        address=address.strip() or master_issue.address,
        media_storage_key=photo_key,
        phash=phash,
        status="LINKED",
    )
    db.add(report)

    # Increment master issue report count
    master_issue.report_count += 1
    master_issue.updated_at = datetime.utcnow()

    # Recalculate priority with increased report count
    sev = "moderate"
    if master_issue.ai_analysis and isinstance(master_issue.ai_analysis, dict):
        sev = master_issue.ai_analysis.get("severity", "moderate")

    new_prio = calculate_priority_score(
        category=master_issue.category.value,
        severity=sev,
        address=master_issue.address,
        zone=master_issue.zone,
        lat=master_issue.lat,
        lng=master_issue.lng,
        description=master_issue.description,
        report_count=master_issue.report_count,
        created_at=master_issue.created_at,
    )
    master_issue.priority_score = new_prio["score"]
    master_issue.priority_band = new_prio["band"]
    master_issue.priority_breakdown = new_prio["factors"]
    master_issue.priority = models.Priority(new_prio["band"])

    add_event(
        db,
        master_issue,
        reporter,
        "REPORT_LINKED",
        f"Citizen report {report_ticket} linked to this master issue (Total reports: {master_issue.report_count}). Recalculated priority score: {master_issue.priority_score} ({master_issue.priority_band}).",
        {"report_ticket": report_ticket, "report_count": master_issue.report_count, "new_priority": new_prio["score"]},
    )
    notify(
        db,
        reporter.id,
        f"Complaint linked to existing issue {master_issue.ticket_no}",
        f"Your report was matched to an existing defect under active management. Ticket: {report_ticket}",
        "REPORT_LINKED",
        "/citizen/reports",
    )
    notify_admins(
        db,
        f"Report count increased for {master_issue.ticket_no}",
        f"Now at {master_issue.report_count} reports. Dynamic priority escalated to {master_issue.priority_score:.1f} ({master_issue.priority_band}).",
        "ADMIN_ALERT",
        "/admin/review",
    )
    log_audit(
        db,
        "REPORT_LINKED_TO_MASTER",
        reporter,
        "ISSUE",
        master_issue.id,
        {"report_ticket": report_ticket, "total_reports": master_issue.report_count},
    )
    return report


def merge_master_issues(db: Session, source_issue: models.Issue, target_issue: models.Issue, admin: models.User, reason: str = "") -> None:
    """Admin-approved merge of duplicate master issues preserving full report history."""
    if source_issue.id == target_issue.id:
        raise ValueError("Cannot merge an issue into itself")
    if source_issue.status in (models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.DUPLICATE):
        raise ValueError("Only open issues can be merged")

    source_issue.status = models.IssueStatus.DUPLICATE
    source_issue.duplicate_of_id = target_issue.id
    source_issue.assigned_worker_id = None
    source_issue.updated_at = datetime.utcnow()

    # Move/link citizen reports to target
    for cr in source_issue.citizen_reports:
        cr.issue_id = target_issue.id

    # Create an explicit CitizenReport record for the source issue itself
    merged_report = models.CitizenReport(
        issue_id=target_issue.id,
        reporter_id=source_issue.reporter_id,
        ticket_no=f"{source_issue.ticket_no}-MERGED",
        description=source_issue.description,
        category=source_issue.category,
        lat=source_issue.lat,
        lng=source_issue.lng,
        address=source_issue.address,
        status="LINKED",
    )
    db.add(merged_report)

    target_issue.report_count += max(1, source_issue.report_count)
    target_issue.updated_at = datetime.utcnow()

    # Recalculate priority
    sev = "moderate"
    if target_issue.ai_analysis and isinstance(target_issue.ai_analysis, dict):
        sev = target_issue.ai_analysis.get("severity", "moderate")
    new_prio = calculate_priority_score(
        category=target_issue.category.value,
        severity=sev,
        address=target_issue.address,
        zone=target_issue.zone,
        lat=target_issue.lat,
        lng=target_issue.lng,
        description=target_issue.description,
        report_count=target_issue.report_count,
        created_at=target_issue.created_at,
    )
    target_issue.priority_score = new_prio["score"]
    target_issue.priority_band = new_prio["band"]
    target_issue.priority_breakdown = new_prio["factors"]
    target_issue.priority = models.Priority(new_prio["band"])

    add_event(db, source_issue, admin, "DUPLICATE_MERGED", f"Merged into {target_issue.ticket_no}. {reason}".strip())
    add_event(db, target_issue, admin, "DUPLICATE_MERGED", f"{source_issue.ticket_no} merged into this master issue. Total reports: {target_issue.report_count}. New priority: {target_issue.priority_score:.1f}.", {"source_ticket": source_issue.ticket_no})
    log_audit(db, "MERGE_ISSUES", admin, "ISSUE", target_issue.id, {"source_id": source_issue.id, "source_ticket": source_issue.ticket_no, "target_ticket": target_issue.ticket_no, "reason": reason})


def unmerge_master_issue(db: Session, duplicate_issue: models.Issue, admin: models.User, reason: str = "") -> None:
    """Safe unmerge / recovery of an incorrectly merged master issue."""
    if duplicate_issue.status != models.IssueStatus.DUPLICATE or not duplicate_issue.duplicate_of_id:
        raise ValueError("Issue is not in DUPLICATE status")

    target_issue = db.query(models.Issue).get(duplicate_issue.duplicate_of_id)
    duplicate_issue.status = models.IssueStatus.UNDER_REVIEW
    duplicate_issue.duplicate_of_id = None
    duplicate_issue.updated_at = datetime.utcnow()

    if target_issue:
        target_issue.report_count = max(1, target_issue.report_count - max(1, duplicate_issue.report_count))
        target_issue.updated_at = datetime.utcnow()
        sev = "moderate"
        if target_issue.ai_analysis and isinstance(target_issue.ai_analysis, dict):
            sev = target_issue.ai_analysis.get("severity", "moderate")
        new_prio = calculate_priority_score(
            category=target_issue.category.value,
            severity=sev,
            address=target_issue.address,
            zone=target_issue.zone,
            lat=target_issue.lat,
            lng=target_issue.lng,
            description=target_issue.description,
            report_count=target_issue.report_count,
            created_at=target_issue.created_at,
        )
        target_issue.priority_score = new_prio["score"]
        target_issue.priority_band = new_prio["band"]
        target_issue.priority_breakdown = new_prio["factors"]
        target_issue.priority = models.Priority(new_prio["band"])
        add_event(db, target_issue, admin, "DUPLICATE_UNMERGED", f"{duplicate_issue.ticket_no} unmerged from this issue. Report count adjusted to {target_issue.report_count}.")

    add_event(db, duplicate_issue, admin, "DUPLICATE_UNMERGED", f"Unmerged and restored to UNDER_REVIEW. {reason}".strip())
    log_audit(db, "UNMERGE_ISSUES", admin, "ISSUE", duplicate_issue.id, {"target_id": target_issue.id if target_issue else None, "reason": reason})
