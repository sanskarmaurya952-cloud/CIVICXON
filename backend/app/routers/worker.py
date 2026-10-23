from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import require_worker
from ..storage import get_storage, validate_image
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
    issues = (
        db.query(models.Issue)
        .filter(models.Issue.assigned_worker_id == profile.id)
        .filter(models.Issue.status.in_([models.IssueStatus.ASSIGNED, models.IssueStatus.IN_PROGRESS, models.IssueStatus.PENDING_VERIFICATION, models.IssueStatus.REWORK_REQUIRED]))
        .order_by(models.Issue.created_at.desc())
        .all()
    )
    return [{"id": i.id, "ticket_no": i.ticket_no, "category": i.category.value, "status": i.status.value,
             "priority": i.priority.value, "description": i.description, "address": i.address,
             "zone": i.zone, "rework_count": i.rework_count} for i in issues]


@router.post("/jobs/{issue_id}/start")
def start_work(issue_id: int, db: Session = Depends(get_db), user: models.User = Depends(require_worker)):
    profile = _my_profile(db, user)
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.assigned_worker_id != profile.id:
        raise HTTPException(403, "This job is not assigned to you")
    if issue.status == models.IssueStatus.IN_PROGRESS:
        return {"ok": True, "status": issue.status.value}
    from_status = workflow.set_status(db, issue, models.IssueStatus.IN_PROGRESS)
    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": "worker"}, "WORK_STARTED", "Worker started repair work.")
    if from_status != models.IssueStatus.IN_PROGRESS:
        workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": "worker"}, "STATUS_CHANGE", f"Status: {from_status.value} → IN_PROGRESS")
    db.commit()
    return {"ok": True, "status": issue.status.value}


@router.post("/jobs/{issue_id}/evidence", status_code=201)
def submit_evidence(issue_id: int, caption: str = Form("After repair"), photo: UploadFile = File(...),
                    db: Session = Depends(get_db), user: models.User = Depends(require_worker)):
    profile = _my_profile(db, user)
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.assigned_worker_id != profile.id:
        raise HTTPException(403, "This job is not assigned to you")
    if issue.status != models.IssueStatus.IN_PROGRESS:
        raise HTTPException(409, f"Evidence only from IN_PROGRESS (current: {issue.status.value})")
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}:
        raise HTTPException(415, "Unsupported image type")
    data = photo.file.read()
    validate_image(photo.filename or "after.jpg", photo.content_type or "image/jpeg", len(data))

    storage = get_storage()
    key = storage.save(photo.filename or "after.jpg", data, photo.content_type or "image/jpeg")
    media = models.Media(issue_id=issue.id, type="AFTER", storage_key=key, caption=caption.strip()[:255], uploaded_by=user.id)
    db.add(media)
    db.flush()

    before = db.query(models.Media).filter(models.Media.issue_id == issue.id, models.Media.type == "BEFORE").order_by(models.Media.id.desc()).first()
    before_key = before.storage_key if before else key
    before_local = before_key if before_key.startswith('/') or before_key.startswith('.') else f"./uploads/{before_key}"
    after_local = f"./uploads/{key}" if not key.startswith("http") else key
    assessment = ai.assess_repair(before_local, after_local, issue.category.value, issue.description)

    review = models.VerificationReview(
        issue_id=issue.id, provider=assessment["provider"], model=assessment.get("model"),
        outcome=assessment["outcome"], explanation=assessment["explanation"], limitations=assessment["limitations"],
        confidence=assessment["confidence"], comparison_media_ids=[before.id if before else 0, media.id],
        reviewer_name=user.name,
    )
    db.add(review)
    from_status = workflow.set_status(db, issue, models.IssueStatus.PENDING_VERIFICATION)
    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": "worker"}, "EVIDENCE_SUBMITTED",
                       f"Worker submitted repair evidence. AI pre-check ({assessment['provider']}): {assessment['outcome'].replace('_', ' ')}",
                       {"outcome": assessment["outcome"]})
    workflow.add_event(db, issue, {"id": user.id, "name": user.name, "role": "worker"}, "STATUS_CHANGE", f"Status: {from_status.value} → PENDING_VERIFICATION")
    workflow.notify_admins(db, f"Verification needed: {issue.ticket_no}", f"AI pre-check: {assessment['outcome'].replace('_', ' ')}", "ADMIN_ALERT", "/admin/verification")
    db.commit()
    return {"ok": True, "verification": {"outcome": assessment["outcome"], "provider": assessment["provider"], "confidence": assessment["confidence"]}}
