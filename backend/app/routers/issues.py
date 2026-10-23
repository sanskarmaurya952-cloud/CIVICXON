import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import text
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import get_current_user, require_admin, require_citizen, require_worker
from ..storage import get_storage, validate_image
from ..services import ai, allocation, workflow
from ..config import settings

router = APIRouter(prefix="/api/issues", tags=["issues"])


def _issue_summary(db: Session, issue: models.Issue) -> dict:
    lat, lng = db.execute(text("SELECT ST_Y(location::geometry), ST_X(location::geometry) FROM issues WHERE id=:i"), {"i": issue.id}).one()
    return {
        "id": issue.id, "ticket_no": issue.ticket_no, "category": issue.category.value, "status": issue.status.value,
        "priority": issue.priority.value, "description": issue.description, "address": issue.address,
        "lat": lat, "lng": lng, "zone": issue.zone, "reporter_id": issue.reporter_id,
        "assigned_worker_id": issue.assigned_worker_id, "duplicate_of_id": issue.duplicate_of_id,
        "rework_count": issue.rework_count, "ai_analysis": issue.ai_analysis,
        "priority_reason": issue.priority_reason, "rejected_reason": issue.rejected_reason,
        "created_at": issue.created_at.isoformat(), "updated_at": issue.updated_at.isoformat(),
    }


@router.get("")
def list_issues(status: str | None = None, category: str | None = None, priority: str | None = None,
                mine: bool = False, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    q = db.query(models.Issue)
    if user.role == models.Role.citizen:
        q = q.filter(models.Issue.reporter_id == user.id)
    elif user.role == models.Role.worker:
        profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
        q = q.filter(models.Issue.assigned_worker_id == (profile.id if profile else -1))
    if status:
        q = q.filter(models.Issue.status == models.IssueStatus(status))
    if category:
        q = q.filter(models.Issue.category == models.IssueCategory(category))
    if priority:
        q = q.filter(models.Issue.priority == models.Priority(priority))
    return [_issue_summary(db, i) for i in q.order_by(models.Issue.created_at.desc()).limit(500).all()]


@router.post("", status_code=201)
def create_issue(
    description: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    address: str = Form(""),
    category: str = Form("auto"),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_citizen),
):
    if len(description.strip()) < 12:
        raise HTTPException(422, "Description must be at least 12 characters")
    # resolve zone by nearest zone centre (PostGIS)
    zone = db.execute(text(
        "SELECT name FROM zones ORDER BY ST_Distance(center, ST_GeogFromText(:pt)) ASC LIMIT 1"
    ), {"pt": f"SRID=4326;POINT({lng} {lat})"}).scalar() or "Central"

    media_bytes, media_type = None, None
    if photo is not None:
        if photo.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}:
            raise HTTPException(415, "Only JPEG/PNG/WebP/HEIC images are accepted")
        media_bytes = photo.file.read()
        validate_image(photo.filename or "photo.jpg", photo.content_type or "image/jpeg", len(media_bytes))
        media_type = photo.content_type

    analysis = ai.analyze_issue(description)
    final_category = category if category in ("pothole", "streetlight") else analysis["category"]
    sev = analysis.get("severity", "moderate")
    priority = models.Priority({"low": "LOW", "moderate": "MEDIUM", "severe": "HIGH", "critical": "CRITICAL"}[sev])

    ticket = f"CX-2026-{db.query(models.Issue).count() + 1:04d}"
    point_wkt = f"SRID=4326;POINT({lng} {lat})"
    issue = models.Issue(
        ticket_no=ticket, category=models.IssueCategory(final_category), description=description.strip(),
        status=models.IssueStatus.REPORTED, priority=priority, reporter_id=user.id,
        address=address.strip(), zone=zone, ai_analysis=analysis,
    )
    db.add(issue)
    db.flush()
    db.execute(text("UPDATE issues SET location = ST_GeogFromText(:pt) WHERE id = :i"), {"pt": point_wkt, "i": issue.id})

    storage_key = None
    if media_bytes:
        storage_key = get_storage().save(photo.filename or "evidence.jpg", media_bytes, media_type or "image/jpeg")
        db.add(models.Media(issue_id=issue.id, type="BEFORE", storage_key=storage_key, caption="Citizen report photo", uploaded_by=user.id))

    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": "citizen"}, "CREATED", "Citizen reported the issue with photo evidence." if media_bytes else "Citizen reported the issue.")
    workflow.add_event(db, issue, None, "AI_ANALYSIS", f"AI analysis ({analysis['provider']}): {final_category} · {sev} · confidence {analysis.get('confidence', 0):.2f}", {"severity": sev, "provider": analysis["provider"]})
    duplicates = workflow.find_duplicates(db, models.IssueCategory(final_category), description, lat, lng, exclude_issue_id=issue.id)
    for dup in duplicates:
        workflow.add_event(db, issue, None, "DUPLICATE_FLAGGED", f"Possible duplicate of {dup['ticket_no']} ({dup['combined']:.0%} match) — admin will confirm.", dup)
    workflow.notify(db, user.id, f"Report {ticket} received", f"Triaged as {final_category} · {sev}. Awaiting admin review.", "REPORT_RECEIVED", "/citizen/reports")
    workflow.notify_admins(db, f"New report {ticket}", f"{final_category} · {sev} · {address or f'{lat:.4f},{lng:.4f}'}", "ADMIN_ALERT", "/admin/review")
    db.commit()
    db.refresh(issue)
    return {"id": issue.id, "ticket_no": ticket, "duplicate_hints": duplicates}


@router.get("/{issue_id}")
def get_issue(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen and issue.reporter_id != user.id:
        raise HTTPException(403, "Not your report")
    return _issue_summary(db, issue)


@router.get("/{issue_id}/events")
def issue_events(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen and issue.reporter_id != user.id:
        raise HTTPException(403, "Not your report")
    if user.role == models.Role.worker:
        profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
        if not profile or issue.assigned_worker_id != profile.id:
            raise HTTPException(403, "Not your job")
    events = db.query(models.IssueEvent).filter(models.IssueEvent.issue_id == issue_id).order_by(models.IssueEvent.at).all()
    return [{"id": e.id, "at": e.at.isoformat(), "actor_name": e.actor_name, "actor_role": e.actor_role, "type": e.type, "message": e.message, "meta": e.meta} for e in events]


@router.post("/{issue_id}/notes")
def add_note(issue_id: int, note: str = Form(...), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen and issue.reporter_id != user.id:
        raise HTTPException(403, "You can only annotate your own reports")
    if user.role == models.Role.worker:
        profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
        if not profile or issue.assigned_worker_id != profile.id:
            raise HTTPException(403, "Not your job")
    if len(note.strip()) < 1:
        raise HTTPException(422, "Note cannot be empty")
    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": user.role.value}, "NOTE", note.strip())
    db.commit()
    return {"ok": True}


@router.post("/{issue_id}/cancel")
def cancel_issue(issue_id: int, reason: str = Form(""), db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen:
        if issue.reporter_id != user.id:
            raise HTTPException(403, "You can only cancel your own reports")
        if issue.status not in (models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW):
            raise HTTPException(409, "This report is already being worked on")
    if issue.status in (models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED, models.IssueStatus.DUPLICATE):
        raise HTTPException(409, "Issue is closed")
    workflow.set_status(db, issue, models.IssueStatus.CANCELLED)
    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": user.role.value}, "CANCELLED", f"Issue cancelled: {reason or 'no reason given'}")
    db.commit()
    return {"ok": True, "status": issue.status.value}
