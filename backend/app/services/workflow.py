"""Audit-trail + status transitions shared by all routers."""
from datetime import datetime
from sqlalchemy.orm import Session
from .. import models


def add_event(db: Session, issue: models.Issue, actor, type_: str, message: str, meta: dict | None = None):
    actor_id, actor_name, actor_role = None, "CivicXon System", "system"
    if actor is not None:
        actor_id = actor.id
        actor_name = actor.name
        actor_role = actor.role.value if hasattr(actor.role, "value") else str(actor.role)
    db.add(models.IssueEvent(issue_id=issue.id, actor_id=actor_id, actor_name=actor_name, actor_role=actor_role, type=type_, message=message, meta=meta))


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
    import re
    stop = {"the","a","an","is","are","was","were","in","on","at","of","to","for","and","or","with","near","my","our","this","that","it","has","have"}
    tok = lambda s: [t for t in re.findall(r"[a-z]+", s.lower()) if t not in stop and len(t) > 2]
    A, B = set(tok(a)), set(tok(b))
    if not A or not B:
        return 0.0
    inter = len(A & B)
    union = len(A | B)
    return inter / union if union else 0.0


def find_duplicates(db: Session, category: models.IssueCategory, description: str, lat: float, lng: float, radius_km: float = 0.35, exclude_issue_id: int | None = None):
    from geoalchemy2.functions import ST_DWithin, ST_Distance, ST_MakePoint, ST_SetSRID, ST_Y, ST_X
    from sqlalchemy import func
    point = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
    q = db.query(
        models.Issue,
        ST_Distance(models.Issue.location, func.ST_GeogFromText(f"SRID=4326;POINT({lng} {lat})")).label("distance"),
    ).filter(
        models.Issue.location.op("&&")(func.ST_Expand(func.ST_GeogFromText(f"SRID=4326;POINT({lng} {lat})"), radius_km / 111320.0)),
        models.Issue.status.notin_([models.IssueStatus.DUPLICATE, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED]),
    )
    if exclude_issue_id:
        q = q.filter(models.Issue.id != exclude_issue_id)
    out = []
    for issue, distance_m in q.limit(50).all():
        if distance_m is None or distance_m > radius_km * 1000:
            continue
        dist_km = distance_m / 1000.0
        cat_match = issue.category == category
        text_sim = text_similarity(description, issue.description)
        proximity = max(0.0, 1 - dist_km / radius_km)
        combined = (0.34 if cat_match else 0) + 0.28 * proximity + 0.24 * text_sim
        if combined >= 0.34 or (cat_match and dist_km < 0.12):
            out.append({
                "issue_id": issue.id, "ticket_no": issue.ticket_no, "distance_km": round(dist_km, 3),
                "category_match": cat_match, "text_similarity": round(text_sim, 3), "combined": round(combined, 3),
                "description": issue.description,
            })
    out.sort(key=lambda d: d["combined"], reverse=True)
    return out[:5]
