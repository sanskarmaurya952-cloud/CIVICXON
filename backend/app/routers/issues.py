import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import get_current_user, require_admin, require_citizen, require_worker
from ..storage import get_storage, validate_image, compute_phash
from ..services import ai, allocation, workflow
from ..services.priority import calculate_priority_score
from ..config import settings

router = APIRouter(prefix="/api/issues", tags=["issues"])


def _issue_summary(db: Session, issue: models.Issue) -> dict:
    storage = get_storage()
    media_items = [
        {
            "id": m.id,
            "type": m.type,
            "storage_key": m.storage_key,
            "url": storage.url(m.storage_key),
            "caption": m.caption,
            "uploaded_by": m.uploaded_by,
            "uploaded_at": m.uploaded_at.isoformat() if m.uploaded_at else None,
        }
        for m in (issue.media or [])
    ]
    reports = [
        {
            "id": r.id,
            "ticket_no": r.ticket_no,
            "reporter_id": r.reporter_id,
            "description": r.description,
            "category": r.category.value if hasattr(r.category, "value") else str(r.category),
            "address": r.address,
            "lat": r.lat,
            "lng": r.lng,
            "media_url": storage.url(r.media_storage_key) if r.media_storage_key else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "status": r.status,
        }
        for r in (issue.citizen_reports or [])
    ]

    return {
        "id": issue.id,
        "ticket_no": issue.ticket_no,
        "category": issue.category.value if hasattr(issue.category, "value") else str(issue.category),
        "status": issue.status.value if hasattr(issue.status, "value") else str(issue.status),
        "priority": issue.priority.value if hasattr(issue.priority, "value") else str(issue.priority),
        "priority_score": round(float(issue.priority_score or 50.0), 1),
        "priority_band": issue.priority_band or "MEDIUM",
        "priority_breakdown": issue.priority_breakdown,
        "priority_override": issue.priority_override,
        "priority_reason": issue.priority_reason,
        "description": issue.description,
        "address": issue.address,
        "lat": issue.lat,
        "lng": issue.lng,
        "zone": issue.zone,
        "reporter_id": issue.reporter_id,
        "assigned_worker_id": issue.assigned_worker_id,
        "duplicate_of_id": issue.duplicate_of_id,
        "report_count": issue.report_count or 1,
        "rework_count": issue.rework_count or 0,
        "ai_analysis": issue.ai_analysis,
        "rejected_reason": issue.rejected_reason,
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
        "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        "assigned_at": issue.assigned_at.isoformat() if issue.assigned_at else None,
        "started_at": issue.started_at.isoformat() if issue.started_at else None,
        "resolved_at": issue.resolved_at.isoformat() if issue.resolved_at else None,
        "verified_at": issue.verified_at.isoformat() if issue.verified_at else None,
        "media": media_items,
        "citizen_reports": reports,
    }


@router.get("")
def list_issues(
    status: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    zone: str | None = None,
    q: str | None = None,
    sort_by: str = "priority_score",  # PRD Page 16: Sort by highest priority score by default
    order: str = "desc",
    mine: bool = False,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    query = db.query(models.Issue)

    # Scoped access
    if user.role == models.Role.citizen:
        query = query.filter(models.Issue.reporter_id == user.id)
    elif user.role == models.Role.worker:
        profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
        query = query.filter(models.Issue.assigned_worker_id == (profile.id if profile else -1))

    if status:
        try:
            query = query.filter(models.Issue.status == models.IssueStatus(status))
        except ValueError:
            pass
    if category:
        try:
            query = query.filter(models.Issue.category == models.IssueCategory(category))
        except ValueError:
            pass
    if priority:
        try:
            query = query.filter(models.Issue.priority == models.Priority(priority))
        except ValueError:
            pass
    if zone:
        query = query.filter(models.Issue.zone == zone)
    if q and q.strip():
        term = f"%{q.strip()}%"
        query = query.filter(
            (models.Issue.ticket_no.ilike(term)) |
            (models.Issue.description.ilike(term)) |
            (models.Issue.address.ilike(term))
        )

    # Ordering
    if sort_by == "priority_score":
        query = query.order_by(models.Issue.priority_score.desc() if order == "desc" else models.Issue.priority_score.asc())
    elif sort_by == "created_at":
        query = query.order_by(models.Issue.created_at.desc() if order == "desc" else models.Issue.created_at.asc())
    elif sort_by == "report_count":
        query = query.order_by(models.Issue.report_count.desc() if order == "desc" else models.Issue.report_count.asc())
    else:
        query = query.order_by(models.Issue.priority_score.desc())

    issues = query.limit(500).all()
    return [_issue_summary(db, i) for i in issues]


@router.post("", status_code=201)
def create_issue(
    description: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    address: str = Form(""),
    category: str = Form("auto"),
    link_to_master_id: int | None = Form(None),  # Explicitly link as duplicate citizen report
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_citizen),
):
    if len(description.strip()) < 10:
        raise HTTPException(422, "Description must be at least 10 characters")

    # Resolve zone by proximity to zone centers
    zones = db.query(models.Zone).all()
    if zones:
        nearest_zone = min(zones, key=lambda z: workflow.haversine_km(lat, lng, z.lat, z.lng))
        zone_name = nearest_zone.name
    else:
        zone_name = "Central"

    # Photo validation and perceptual hashing
    media_bytes = None
    media_type = None
    phash = None
    if photo is not None and photo.filename:
        if photo.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}:
            raise HTTPException(415, "Only JPEG/PNG/WebP/HEIC images are accepted")
        media_bytes = photo.file.read()
        validate_image(photo.filename or "photo.jpg", photo.content_type or "image/jpeg", len(media_bytes))
        media_type = photo.content_type
        phash = compute_phash(media_bytes)

    # AI image & description triage
    analysis = ai.analyze_issue(description)
    final_cat_str = category if category in ("pothole", "streetlight") else analysis.get("category", "pothole")
    final_category = models.IssueCategory(final_cat_str)
    sev = analysis.get("severity", "moderate")

    # Check for existing duplicate candidates
    duplicates = workflow.find_duplicates(db, final_category, description, lat, lng, phash=phash)

    # If the user specifically chose to link to an existing master issue:
    if link_to_master_id:
        target_master = db.get(models.Issue, link_to_master_id)
        if target_master:
            storage_key = None
            if media_bytes:
                storage_key = get_storage().save(photo.filename or "report.jpg", media_bytes, media_type or "image/jpeg")
            linked_report = workflow.link_citizen_report(
                db=db,
                master_issue=target_master,
                reporter=user,
                description=description,
                lat=lat,
                lng=lng,
                address=address,
                photo_key=storage_key,
                phash=phash,
            )
            db.commit()
            return {
                "id": target_master.id,
                "ticket_no": linked_report.ticket_no,
                "master_ticket_no": target_master.ticket_no,
                "linked_to_master": True,
                "report_count": target_master.report_count,
                "duplicate_hints": duplicates,
            }

    # Deterministic 7-factor Priority Calculation (PRD Page 16)
    prio_result = calculate_priority_score(
        category=final_cat_str,
        severity=sev,
        address=address,
        zone=zone_name,
        lat=lat,
        lng=lng,
        description=description,
        report_count=1,
    )

    ticket = f"CX-2026-{db.query(models.Issue).count() + 1:04d}"
    issue = models.Issue(
        ticket_no=ticket,
        category=final_category,
        description=description.strip(),
        status=models.IssueStatus.REPORTED,
        priority=models.Priority(prio_result["band"]),
        priority_score=prio_result["score"],
        priority_band=prio_result["band"],
        priority_breakdown=prio_result["factors"],
        priority_reason=prio_result["explanation"],
        reporter_id=user.id,
        address=address.strip(),
        lat=lat,
        lng=lng,
        zone=zone_name,
        report_count=1,
        ai_analysis=analysis,
    )
    db.add(issue)
    db.flush()

    # Save photo if uploaded
    storage_key = None
    if media_bytes:
        storage_key = get_storage().save(photo.filename or "evidence.jpg", media_bytes, media_type or "image/jpeg")
        db.add(models.Media(
            issue_id=issue.id,
            type="BEFORE",
            storage_key=storage_key,
            caption="Citizen report before-photo",
            uploaded_by=user.id,
            phash=phash,
        ))

    # Create root CitizenReport record linked to master issue
    db.add(models.CitizenReport(
        issue_id=issue.id,
        reporter_id=user.id,
        ticket_no=f"{ticket}-R1",
        description=description.strip(),
        category=final_category,
        lat=lat,
        lng=lng,
        address=address.strip(),
        media_storage_key=storage_key,
        phash=phash,
        status="ORIGINAL_MASTER",
    ))

    # Audit events & notifications
    workflow.add_event(
        db,
        issue,
        user,
        "CREATED",
        "Citizen submitted complaint with photo evidence." if media_bytes else "Citizen submitted complaint.",
    )
    workflow.add_event(
        db,
        issue,
        None,
        "AI_ANALYSIS",
        f"AI analysis ({analysis['provider']}): {final_cat_str} · {sev} · confidence {analysis.get('confidence', 0):.2f}",
        analysis,
    )
    workflow.add_event(
        db,
        issue,
        None,
        "PRIORITY_CALCULATED",
        f"Dynamic Priority calculated: {prio_result['score']} ({prio_result['band']}). {prio_result['explanation']}",
        prio_result,
    )

    # Flag duplicate candidates for admin review
    for dup in duplicates:
        workflow.add_event(
            db,
            issue,
            None,
            "DUPLICATE_FLAGGED",
            f"Possible duplicate match with {dup['ticket_no']} ({dup['combined']:.0%} confidence: {dup['classification']}). Awaiting admin confirmation.",
            dup,
        )

    workflow.notify(
        db,
        user.id,
        f"Report {ticket} received",
        f"Triaged as {final_cat_str} · {prio_result['band']} priority ({prio_result['score']} pts). Awaiting review.",
        "REPORT_RECEIVED",
        "/citizen/reports",
    )
    workflow.notify_admins(
        db,
        f"New report {ticket}",
        f"{final_cat_str} · {prio_result['band']} ({prio_result['score']} pts) · {address or f'{lat:.4f},{lng:.4f}'}",
        "ADMIN_ALERT",
        "/admin/review",
    )

    db.commit()
    db.refresh(issue)
    return {
        "id": issue.id,
        "ticket_no": ticket,
        "priority_score": issue.priority_score,
        "priority_band": issue.priority_band,
        "duplicate_hints": duplicates,
    }


@router.get("/{issue_id}")
def get_issue(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen and issue.reporter_id != user.id:
        raise HTTPException(403, "Not your report")
    return _issue_summary(db, issue)


@router.get("/{issue_id}/events")
def issue_events(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen and issue.reporter_id != user.id:
        raise HTTPException(403, "Not your report")
    if user.role == models.Role.worker:
        profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
        if not profile or issue.assigned_worker_id != profile.id:
            raise HTTPException(403, "Not your job")
    events = db.query(models.IssueEvent).filter(models.IssueEvent.issue_id == issue_id).order_by(models.IssueEvent.at).all()
    return [
        {
            "id": e.id,
            "at": e.at.isoformat(),
            "actor_name": e.actor_name,
            "actor_role": e.actor_role,
            "type": e.type,
            "message": e.message,
            "meta": e.meta,
        }
        for e in events
    ]


@router.post("/{issue_id}/notes")
def add_note(
    issue_id: int,
    note: str = Form(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    issue = db.get(models.Issue, issue_id)
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
    workflow.add_event(db, issue, user, "NOTE", note.strip())
    db.commit()
    return {"ok": True}


@router.post("/{issue_id}/cancel")
def cancel_issue(
    issue_id: int,
    reason: str = Form(""),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if user.role == models.Role.citizen:
        if issue.reporter_id != user.id:
            raise HTTPException(403, "You can only cancel your own reports")
        if issue.status not in (models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW):
            raise HTTPException(409, "This report is already assigned or in progress")
    if issue.status in (models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED, models.IssueStatus.DUPLICATE):
        raise HTTPException(409, "Issue is already closed")

    workflow.set_status(db, issue, models.IssueStatus.CANCELLED)
    workflow.add_event(db, issue, user, "CANCELLED", f"Issue cancelled by user: {reason or 'No reason provided'}")
    workflow.log_audit(db, "CANCEL_ISSUE", user, "ISSUE", issue.id, {"reason": reason})
    db.commit()
    return {"ok": True, "status": issue.status.value}
