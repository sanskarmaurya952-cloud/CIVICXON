import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import text, func
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import require_admin
from ..services import ai, allocation, workflow
from ..config import settings
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    counts = dict(db.query(models.Issue.status, func.count(models.Issue.id)).group_by(models.Issue.status).all())
    by_priority = dict(db.query(models.Issue.priority, func.count(models.Issue.id)).group_by(models.Issue.priority).all())
    by_category = dict(db.query(models.Issue.category, func.count(models.Issue.id)).group_by(models.Issue.category).all())
    unassigned = db.query(models.Issue).filter(models.Issue.status == models.IssueStatus.UNDER_REVIEW, models.Issue.assigned_worker_id.is_(None)).count()
    critical = db.query(models.Issue).filter(models.Issue.priority == models.Priority.CRITICAL, models.Issue.status.notin_([models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED, models.IssueStatus.DUPLICATE])).count()
    workers_available = db.query(models.WorkerProfile).filter(models.WorkerProfile.availability == "AVAILABLE").count()
    return {
        "total": sum(counts.values()),
        "by_status": {s.value: counts.get(s, 0) for s in models.IssueStatus},
        "by_priority": {p.value: by_priority.get(p, 0) for p in models.Priority},
        "by_category": {c.value: by_category.get(c, 0) for c in models.IssueCategory},
        "unassigned": unassigned,
        "critical_open": critical,
        "workers_available": workers_available,
        "verification_queue": counts.get(models.IssueStatus.PENDING_VERIFICATION, 0),
    }


class DecisionIn(BaseModel):
    priority: str
    priority_reason: str


@router.post("/issues/{issue_id}/approve-review")
def approve_review(issue_id: int, body: DecisionIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.status not in (models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW):
        raise HTTPException(409, f"Cannot review from {issue.status.value}")
    if len(body.priority_reason.strip()) < 4:
        raise HTTPException(422, "A reason is required when setting priority")
    try:
        from_status = workflow.set_status(db, issue, models.IssueStatus.UNDER_REVIEW)
    except ValueError as e:
        raise HTTPException(409, str(e))
    issue.priority = models.Priority(body.priority)
    issue.priority_reason = body.priority_reason.strip()
    workflow.add_event(db, issue, admin, "PRIORITY_SET", f"Priority set to {body.priority} — {body.priority_reason.strip()}")
    if from_status != models.IssueStatus.UNDER_REVIEW:
        workflow.add_event(db, issue, admin, "STATUS_CHANGE", f"Status: {from_status.value} → UNDER_REVIEW")
    workflow.notify(db, issue.reporter_id, f"Report {issue.ticket_no} under review", f"Priority {body.priority}. Routing to a crew.", "STATUS_UPDATE", "/citizen/reports")

    assigned = None
    if settings.AUTO_ASSIGN:
        ranked = allocation.rank_workers(db, issue)
        eligible = [r for r in ranked if r["eligible"]]
        if eligible:
            assignment = allocation.assign_worker(db, issue, eligible[0]["worker"], "AUTO", admin)
            workflow.add_event(db, issue, admin, "ASSIGNED", f"Auto-assigned to {eligible[0]['user'].name} (score {assignment.score:.1f}). {assignment.reason}")
            workflow.notify(db, eligible[0]["user"].id, f"New job: {issue.ticket_no}", f"{issue.category.value} · {issue.priority.value} · {issue.address}", "WORKER_JOB", "/worker/jobs")
            assigned = {"worker_id": eligible[0]["worker"].id, "score": assignment.score}
        else:
            workflow.add_event(db, issue, admin, "NO_WORKER_AVAILABLE", "No eligible worker after filtering skill/zone/availability/capacity. Manual assignment required.")
            workflow.notify_admins(db, f"No worker available for {issue.ticket_no}", "All candidates filtered out — assign manually.", "ADMIN_ALERT", "/admin/review")
    db.commit()
    return {"ok": True, "status": issue.status.value, "auto_assigned": assigned}


@router.post("/issues/{issue_id}/reject")
def reject_report(issue_id: int, reason: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if len(reason.strip()) < 6:
        raise HTTPException(422, "Rejection reason too short")
    from_status = issue.status
    issue.status = models.IssueStatus.REJECTED
    issue.rejected_reason = reason.strip()
    issue.updated_at = datetime.utcnow()
    workflow.add_event(db, issue, admin, "REJECTED", f"Report rejected: {reason.strip()}", {"from": from_status.value})
    workflow.notify(db, issue.reporter_id, f"Report {issue.ticket_no} rejected", reason.strip(), "REJECTED", "/citizen/reports")
    db.commit()
    return {"ok": True}


@router.post("/issues/{issue_id}/auto-assign")
def auto_assign(issue_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    ranked = allocation.rank_workers(db, issue)
    eligible = [r for r in ranked if r["eligible"]]
    if not eligible:
        workflow.add_event(db, issue, admin, "NO_WORKER_AVAILABLE", "Auto-assignment found no eligible worker.")
        workflow.notify_admins(db, f"No worker for {issue.ticket_no}", "Manual assignment required.", "ADMIN_ALERT", "/admin/review")
        db.commit()
        return {"assigned": False, "eligible_count": 0}
    assignment = allocation.assign_worker(db, issue, eligible[0]["worker"], "AUTO", admin)
    get_db  # noqa
    workflow.add_event(db, issue, admin, "ASSIGNED", f"Auto-assigned to {eligible[0]['user'].name} (score {assignment.score:.1f}). {assignment.reason}")
    workflow.notify(db, eligible[0]["user"].id, f"New job: {issue.ticket_no}", f"{issue.category.value} · {issue.address}", "WORKER_JOB", "/worker/jobs")
    db.commit()
    return {"assigned": True, "eligible_count": len(eligible), "worker_id": eligible[0]["worker"].id, "score": assignment.score}


@router.post("/issues/{issue_id}/assign/{worker_id}")
def manual_assign(issue_id: int, worker_id: int, note: str | None = None, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.query(models.Issue).get(issue_id)
    worker = db.query(models.WorkerProfile).get(worker_id)
    if not issue or not worker:
        raise HTTPException(404, "Not found")
    try:
        assignment = allocation.assign_worker(db, issue, worker, "ADMIN", admin, note)
    except ValueError as e:
        raise HTTPException(409, str(e))
    workflow.add_event(db, issue, admin, "ASSIGNED", f"Manual assignment → {worker.user.name if hasattr(worker, 'user') else ''} (score {assignment.score:.1f}).{' Note: ' + note if note else ''}")
    db.commit()
    return {"ok": True, "score": assignment.score}


@router.post("/issues/{issue_id}/merge/{target_issue_id}")
def merge_duplicate(issue_id: int, target_issue_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if issue_id == target_issue_id:
        raise HTTPException(422, "Cannot merge an issue into itself")
    issue = db.query(models.Issue).get(issue_id)
    target = db.query(models.Issue).get(target_issue_id)
    if not issue or not target:
        raise HTTPException(404, "Issue not found")
    if issue.status in (models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.DUPLICATE):
        raise HTTPException(409, "Only open issues can be merged")
    issue.status = models.IssueStatus.DUPLICATE
    issue.duplicate_of_id = target.id
    issue.assigned_worker_id = None
    issue.updated_at = datetime.utcnow()
    workflow.add_event(db, issue, admin, "DUPLICATE_MERGED", f"Merged into {target.ticket_no} as a confirmed duplicate.")
    workflow.add_event(db, target, admin, "DUPLICATE_MERGED", f"{issue.ticket_no} merged into this report as a confirmed duplicate.")
    db.commit()
    return {"ok": True}


class VerificationDecision(BaseModel):
    decision: str  # APPROVED | REWORK_REQUESTED
    note: str = ""


@router.post("/issues/{issue_id}/verification")
def decide_verification(issue_id: int, body: VerificationDecision, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.query(models.Issue).get(issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.status != models.IssueStatus.PENDING_VERIFICATION:
        raise HTTPException(409, f"Only PENDING_VERIFICATION issues can be decided (current: {issue.status.value})")
    review = db.query(models.VerificationReview).filter(models.VerificationReview.issue_id == issue_id, models.VerificationReview.admin_decision.is_(None)).order_by(models.VerificationReview.created_at.desc()).first()
    if body.decision == "APPROVED":
        if review:
            review.admin_decision = "APPROVED"
            review.admin_note = body.note.strip() or None
            review.decided_at = datetime.utcnow()
            review.decided_by = admin.id
        workflow.set_status(db, issue, models.IssueStatus.VERIFIED)
        workflow.add_event(db, issue, admin, "VERIFICATION_DECISION", f"Admin approved the repair.{' Note: ' + body.note.strip() if body.note.strip() else ''} Ticket closed.", {"decision": "APPROVED"})
        if issue.assigned_worker:
            issue.assigned_worker.jobs_completed += 1
            issue.assigned_worker.current_load = max(0, issue.assigned_worker.current_load - 1)
        workflow.notify(db, issue.reporter_id, f"Report {issue.ticket_no} resolved!", "The repair was verified. Thank you for improving the city.", "VERIFIED", "/citizen/reports")
    elif body.decision == "REWORK_REQUESTED":
        if len(body.note.strip()) < 6:
            raise HTTPException(422, "Rework note too short")
        if review:
            review.admin_decision = "REWORK_REQUESTED"
            review.admin_note = body.note.strip()
            review.decided_at = datetime.utcnow()
            review.decided_by = admin.id
        issue.rework_count += 1
        workflow.set_status(db, issue, models.IssueStatus.REWORK_REQUIRED)
        workflow.add_event(db, issue, admin, "REWORK_REQUESTED", f"Rework requested: {body.note.strip()}")
        if issue.assigned_worker:
            workflow.notify(db, issue.assigned_worker.user_id, f"Rework: {issue.ticket_no}", body.note.strip(), "REWORK", "/worker/rework")
        workflow.notify(db, issue.reporter_id, f"Rework requested on {issue.ticket_no}", "Repair did not pass verification — crew will redo it.", "REWORK", "/citizen/reports")
    else:
        raise HTTPException(422, "decision must be APPROVED or REWORK_REQUESTED")
    db.commit()
    return {"ok": True, "status": issue.status.value}


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    by_day = db.execute(text(
        "SELECT to_char(created_at::date, 'YYYY-MM-DD') d, count(*) FROM issues WHERE created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1"
    )).all()
    avg_hours = db.execute(text(
        "SELECT coalesce(avg(extract(epoch from (verified_at - created_at)) / 3600), 0) FROM issues WHERE verified_at IS NOT NULL"
    )).scalar()
    return {"by_day": [{"date": d, "count": c} for d, c in by_day], "avg_resolution_hours": round(float(avg_hours or 0), 1)}
