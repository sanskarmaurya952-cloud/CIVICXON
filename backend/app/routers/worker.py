from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import require_worker
from ..storage import get_storage, validate_image, compute_phash
from ..services import ai, workflow
from datetime import datetime

router = APIRouter(prefix="/api/worker", tags=["worker"])


def _my_profile(db: Session, user: models.User) -> models.WorkerProfile:
    profile = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user.id).first()
    if not profile:
        raise HTTPException(404, "No worker profile linked to this account")
    return profile


@router.get("/jobs")
def my_jobs(db: Session = Depends(get_db), user: models.User = Depends(require_worker)):
    profile = _my_profile(db, user)
    storage = get_storage()
    issues = (
        db.query(models.Issue)
        .filter(models.Issue.assigned_worker_id == profile.id)
        .filter(models.Issue.status.in_([
            models.IssueStatus.ASSIGNED,
            models.IssueStatus.IN_PROGRESS,
            models.IssueStatus.PENDING_VERIFICATION,
            models.IssueStatus.REWORK_REQUIRED,
            models.IssueStatus.VERIFIED,
        ]))
        .order_by(models.Issue.updated_at.desc())
        .all()
    )

    out = []
    for i in issues:
        media_list = [
            {"id": m.id, "type": m.type, "url": storage.url(m.storage_key), "caption": m.caption}
            for m in (i.media or [])
        ]
        before_photo = next((m["url"] for m in media_list if m["type"] == "BEFORE"), None)
        after_photo = next((m["url"] for m in media_list if m["type"] == "AFTER"), None)

        # Get latest review if any
        latest_review = None
        if i.verifications:
            vr = sorted(i.verifications, key=lambda x: x.created_at, reverse=True)[0]
            latest_review = {
                "outcome": vr.outcome,
                "confidence": vr.confidence,
                "explanation": vr.explanation,
                "limitations": vr.limitations,
                "admin_decision": vr.admin_decision,
                "admin_note": vr.admin_note,
            }

        out.append({
            "id": i.id,
            "ticket_no": i.ticket_no,
            "category": i.category.value if hasattr(i.category, "value") else str(i.category),
            "status": i.status.value if hasattr(i.status, "value") else str(i.status),
            "priority": i.priority.value if hasattr(i.priority, "value") else str(i.priority),
            "priority_score": round(float(i.priority_score or 50.0), 1),
            "priority_band": i.priority_band or "MEDIUM",
            "description": i.description,
            "address": i.address,
            "lat": i.lat,
            "lng": i.lng,
            "zone": i.zone,
            "report_count": i.report_count or 1,
            "rework_count": i.rework_count or 0,
            "assigned_at": i.assigned_at.isoformat() if i.assigned_at else None,
            "started_at": i.started_at.isoformat() if i.started_at else None,
            "before_photo": before_photo,
            "after_photo": after_photo,
            "media": media_list,
            "latest_review": latest_review,
        })
    return out


@router.post("/jobs/{issue_id}/start")
def start_work(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_worker)):
    profile = _my_profile(db, user)
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.assigned_worker_id != profile.id:
        raise HTTPException(403, "This job is not assigned to you")
    if issue.status == models.IssueStatus.IN_PROGRESS:
        return {"ok": True, "status": issue.status.value}
    if issue.status not in (models.IssueStatus.ASSIGNED, models.IssueStatus.REWORK_REQUIRED):
        raise HTTPException(409, f"Cannot start work from status {issue.status.value}")

    from_status = workflow.set_status(db, issue, models.IssueStatus.IN_PROGRESS)
    workflow.add_event(
        db,
        issue,
        user,
        "WORK_STARTED",
        "Worker arrived on site and started repair work." if from_status == models.IssueStatus.ASSIGNED else "Worker started rework on defect.",
    )
    workflow.notify(
        db,
        issue.reporter_id,
        f"Repair started on {issue.ticket_no}",
        "The municipal repair crew has commenced on-site work.",
        "WORK_STARTED",
        "/citizen/reports",
    )
    workflow.log_audit(db, "WORK_STARTED", user, "ISSUE", issue.id, {"worker_id": profile.id})
    db.commit()
    return {"ok": True, "status": issue.status.value}


@router.post("/jobs/{issue_id}/evidence", status_code=201)
def submit_evidence(
    issue_id: int,
    caption: str = Form("After repair completed"),
    note: str = Form(""),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_worker),
):
    profile = _my_profile(db, user)
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.assigned_worker_id != profile.id:
        raise HTTPException(403, "This job is not assigned to you")
    if issue.status not in (models.IssueStatus.IN_PROGRESS, models.IssueStatus.REWORK_REQUIRED):
        raise HTTPException(409, f"Evidence can only be submitted from IN_PROGRESS or REWORK_REQUIRED (current: {issue.status.value})")

    if photo.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}:
        raise HTTPException(415, "Unsupported image type (JPEG, PNG, WebP, HEIC allowed)")

    data = photo.file.read()
    validate_image(photo.filename or "after.jpg", photo.content_type or "image/jpeg", len(data))
    phash = compute_phash(data)

    storage = get_storage()
    key = storage.save(photo.filename or "after.jpg", data, photo.content_type or "image/jpeg")
    combined_caption = f"{caption.strip()}{' — ' + note.strip() if note.strip() else ''}"[:255]
    media = models.Media(
        issue_id=issue.id,
        type="AFTER",
        storage_key=key,
        caption=combined_caption,
        uploaded_by=user.id,
        phash=phash,
    )
    db.add(media)
    db.flush()

    before = db.query(models.Media).filter(models.Media.issue_id == issue.id, models.Media.type == "BEFORE").order_by(models.Media.id.desc()).first()
    before_key = before.storage_key if before else key
    before_local = before_key if before_key.startswith('/') or before_key.startswith('.') else f"./uploads/{before_key}"
    after_local = f"./uploads/{key}" if not key.startswith("http") else key

    # AI repair verification comparison (PRD Page 7 & Page 8)
    cat_str = issue.category.value if hasattr(issue.category, "value") else str(issue.category)
    assessment = ai.assess_repair(before_local, after_local, cat_str, issue.description)

    review = models.VerificationReview(
        issue_id=issue.id,
        provider=assessment["provider"],
        model=assessment.get("model"),
        outcome=assessment["outcome"],
        explanation=assessment["explanation"],
        limitations=assessment["limitations"],
        confidence=assessment["confidence"],
        comparison_media_ids=[before.id if before else 0, media.id],
        reviewer_name=user.name,
    )
    db.add(review)

    workflow.set_status(db, issue, models.IssueStatus.PENDING_VERIFICATION)
    workflow.add_event(
        db,
        issue,
        user,
        "EVIDENCE_SUBMITTED",
        f"Worker submitted repair evidence. AI pre-check ({assessment['provider']}): {assessment['outcome'].replace('_', ' ').upper()} (confidence: {assessment['confidence']:.2f}). Awaiting mandatory Admin verification.",
        {"outcome": assessment["outcome"], "confidence": assessment["confidence"], "note": note},
    )
    workflow.notify(
        db,
        issue.reporter_id,
        f"Repair submitted for verification: {issue.ticket_no}",
        "The field crew completed repairs. Pending municipal administrator review and sign-off.",
        "PENDING_VERIFICATION",
        "/citizen/reports",
    )
    workflow.notify_admins(
        db,
        f"Verification required: {issue.ticket_no}",
        f"Worker submitted repair evidence. AI advisory: {assessment['outcome'].replace('_', ' ').upper()}. Mandatory admin decision required.",
        "ADMIN_ALERT",
        "/admin/verification",
    )
    workflow.log_audit(db, "SUBMIT_EVIDENCE", user, "ISSUE", issue.id, {"outcome": assessment["outcome"]})

    db.commit()
    return {
        "ok": True,
        "verification": {
            "outcome": assessment["outcome"],
            "provider": assessment["provider"],
            "confidence": assessment["confidence"],
            "explanation": assessment["explanation"],
            "limitations": assessment["limitations"],
        },
    }
