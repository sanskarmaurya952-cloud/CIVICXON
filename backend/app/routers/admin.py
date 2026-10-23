import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import text, func
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import require_admin
from ..services import ai, allocation, workflow
from ..services.priority import calculate_priority_score, get_priority_band
from ..storage import get_storage
from ..config import settings
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    counts = dict(db.query(models.Issue.status, func.count(models.Issue.id)).group_by(models.Issue.status).all())
    by_priority = dict(db.query(models.Issue.priority_band, func.count(models.Issue.id)).group_by(models.Issue.priority_band).all())
    by_category = dict(db.query(models.Issue.category, func.count(models.Issue.id)).group_by(models.Issue.category).all())

    unassigned = db.query(models.Issue).filter(
        models.Issue.status.in_([models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW]),
        models.Issue.assigned_worker_id.is_(None)
    ).count()

    critical = db.query(models.Issue).filter(
        models.Issue.priority_band == "CRITICAL",
        models.Issue.status.notin_([models.IssueStatus.VERIFIED, models.IssueStatus.CANCELLED, models.IssueStatus.REJECTED, models.IssueStatus.DUPLICATE])
    ).count()

    workers_active = db.query(models.WorkerProfile).join(models.User).filter(models.User.active == True).count()
    workers_available = db.query(models.WorkerProfile).filter(models.WorkerProfile.availability == "AVAILABLE").count()
    total_citizen_reports = db.query(func.coalesce(func.sum(models.Issue.report_count), 0)).scalar() or 0

    # Calculate average resolution time in hours
    resolved = db.query(models.Issue).filter(models.Issue.verified_at.isnot(None), models.Issue.created_at.isnot(None)).all()
    avg_resolution_hours = 0.0
    if resolved:
        total_hours = sum((i.verified_at - i.created_at).total_seconds() / 3600.0 for i in resolved)
        avg_resolution_hours = round(total_hours / len(resolved), 1)

    return {
        "total": sum(counts.values()),
        "by_status": {s.value: counts.get(s, 0) for s in models.IssueStatus},
        "by_priority": {
            "CRITICAL": by_priority.get("CRITICAL", 0),
            "HIGH": by_priority.get("HIGH", 0),
            "MEDIUM": by_priority.get("MEDIUM", 0),
            "LOW": by_priority.get("LOW", 0),
        },
        "by_category": {
            "pothole": by_category.get(models.IssueCategory.pothole, 0),
            "streetlight": by_category.get(models.IssueCategory.streetlight, 0),
        },
        "unassigned": unassigned,
        "critical_open": critical,
        "workers_active": workers_active,
        "workers_available": workers_available,
        "total_citizen_reports": total_citizen_reports,
        "verification_queue": counts.get(models.IssueStatus.PENDING_VERIFICATION, 0),
        "rework_required": counts.get(models.IssueStatus.REWORK_REQUIRED, 0),
        "in_progress": counts.get(models.IssueStatus.IN_PROGRESS, 0),
        "avg_resolution_hours": avg_resolution_hours,
    }


class DecisionIn(BaseModel):
    priority: str = "MEDIUM"
    priority_reason: str = ""
    override_score: float | None = None


@router.post("/issues/{issue_id}/approve-review")
def approve_review(issue_id: int, body: DecisionIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.status not in (models.IssueStatus.REPORTED, models.IssueStatus.UNDER_REVIEW):
        raise HTTPException(409, f"Cannot review from status {issue.status.value}")

    from_status = workflow.set_status(db, issue, models.IssueStatus.UNDER_REVIEW)

    if body.override_score is not None:
        issue.priority_score = max(0.0, min(100.0, float(body.override_score)))
        issue.priority_band = get_priority_band(issue.priority_score)
        issue.priority = models.Priority(issue.priority_band)
        issue.priority_override = {
            "overridden": True,
            "score": issue.priority_score,
            "band": issue.priority_band,
            "reason": body.priority_reason.strip() or "Admin reviewed and calibrated score",
            "actor_id": admin.id,
            "actor_name": admin.name,
            "timestamp": datetime.utcnow().isoformat(),
        }
    elif body.priority in ("LOW", "MEDIUM", "HIGH", "CRITICAL"):
        issue.priority = models.Priority(body.priority)
        issue.priority_band = body.priority
        if body.priority_reason.strip():
            issue.priority_reason = body.priority_reason.strip()

    workflow.add_event(
        db,
        issue,
        admin,
        "PRIORITY_CONFIRMED",
        f"Admin confirmed review: {issue.priority_band} ({issue.priority_score:.1f} pts). Reason: {body.priority_reason.strip() or 'Reviewed'}",
    )
    workflow.notify(
        db,
        issue.reporter_id,
        f"Report {issue.ticket_no} approved for dispatch",
        f"Your complaint is confirmed as {issue.priority_band} priority and queued for assignment.",
        "STATUS_UPDATE",
        "/citizen/reports",
    )
    workflow.log_audit(db, "APPROVE_REVIEW", admin, "ISSUE", issue.id, {"priority": issue.priority_band, "score": issue.priority_score})

    assigned_info = None
    if settings.AUTO_ASSIGN:
        ranked = allocation.rank_workers(db, issue)
        eligible = [r for r in ranked if r["eligible"]]
        if eligible:
            assignment = allocation.assign_worker(db, issue, eligible[0]["worker"], "AUTO", admin)
            workflow.add_event(
                db,
                issue,
                admin,
                "ASSIGNED",
                f"Auto-assigned to {eligible[0]['user'].name} (score {assignment.score:.1f}). {assignment.reason}",
            )
            workflow.notify(
                db,
                eligible[0]["user"].id,
                f"New job assigned: {issue.ticket_no}",
                f"{issue.category.value} · {issue.priority_band} · {issue.address}",
                "WORKER_JOB",
                "/worker/jobs",
            )
            assigned_info = {"worker_id": eligible[0]["worker"].id, "worker_name": eligible[0]["user"].name, "score": assignment.score}
        else:
            workflow.add_event(db, issue, admin, "NO_WORKER_AVAILABLE", "No eligible worker found. Admin manual allocation required.")
            workflow.notify_admins(db, f"Unassigned issue: {issue.ticket_no}", "No eligible worker found. Manual assignment required.", "ADMIN_ALERT", "/admin/review")

    db.commit()
    return {"ok": True, "status": issue.status.value, "priority_score": issue.priority_score, "priority_band": issue.priority_band, "auto_assigned": assigned_info}


class PriorityOverrideIn(BaseModel):
    score: float
    reason: str


@router.post("/issues/{issue_id}/priority-override")
def priority_override(issue_id: int, body: PriorityOverrideIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """PRD Page 16: Allow Admin to filter, sort, and override priority with a mandatory recorded reason."""
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if len(body.reason.strip()) < 6:
        raise HTTPException(422, "A detailed reason (at least 6 characters) is required for priority override")

    old_score = issue.priority_score
    old_band = issue.priority_band

    new_score = max(0.0, min(100.0, float(body.score)))
    new_band = get_priority_band(new_score)

    issue.priority_score = new_score
    issue.priority_band = new_band
    issue.priority = models.Priority(new_band)
    issue.priority_override = {
        "overridden": True,
        "previous_score": old_score,
        "previous_band": old_band,
        "new_score": new_score,
        "new_band": new_band,
        "reason": body.reason.strip(),
        "actor_id": admin.id,
        "actor_name": admin.name,
        "timestamp": datetime.utcnow().isoformat(),
    }
    issue.priority_reason = f"Admin override: {body.reason.strip()}"
    issue.updated_at = datetime.utcnow()

    workflow.add_event(
        db,
        issue,
        admin,
        "PRIORITY_OVERRIDE",
        f"Admin manually overridden priority from {old_score:.1f} ({old_band}) to {new_score:.1f} ({new_band}). Reason: {body.reason.strip()}",
        issue.priority_override,
    )
    workflow.log_audit(db, "PRIORITY_OVERRIDE", admin, "ISSUE", issue.id, issue.priority_override)
    db.commit()
    return {"ok": True, "score": new_score, "band": new_band}


@router.post("/issues/{issue_id}/reject")
def reject_report(issue_id: int, reason: str, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.get(models.Issue, issue_id)
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
    workflow.log_audit(db, "REJECT_ISSUE", admin, "ISSUE", issue.id, {"reason": reason})
    db.commit()
    return {"ok": True}


@router.post("/issues/{issue_id}/auto-assign")
def auto_assign(issue_id: int, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    ranked = allocation.rank_workers(db, issue)
    eligible = [r for r in ranked if r["eligible"]]
    if not eligible:
        workflow.add_event(db, issue, admin, "NO_WORKER_AVAILABLE", "Auto-assignment found no eligible worker.")
        workflow.notify_admins(db, f"No worker available for {issue.ticket_no}", "Manual assignment required.", "ADMIN_ALERT", "/admin/review")
        db.commit()
        return {"assigned": False, "eligible_count": 0}

    assignment = allocation.assign_worker(db, issue, eligible[0]["worker"], "AUTO", admin)
    workflow.add_event(
        db,
        issue,
        admin,
        "ASSIGNED",
        f"Auto-assigned to {eligible[0]['user'].name} (score {assignment.score:.1f}). {assignment.reason}",
    )
    workflow.notify(
        db,
        eligible[0]["user"].id,
        f"New job assigned: {issue.ticket_no}",
        f"{issue.category.value} · {issue.address}",
        "WORKER_JOB",
        "/worker/jobs",
    )
    workflow.log_audit(db, "AUTO_ASSIGN", admin, "ISSUE", issue.id, {"worker_id": eligible[0]["worker"].id, "score": assignment.score})
    db.commit()
    return {
        "assigned": True,
        "eligible_count": len(eligible),
        "worker_id": eligible[0]["worker"].id,
        "worker_name": eligible[0]["user"].name,
        "score": assignment.score,
    }


@router.post("/issues/{issue_id}/assign/{worker_id}")
def manual_assign(
    issue_id: int,
    worker_id: int,
    note: str | None = None,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    issue = db.get(models.Issue, issue_id)
    worker = db.get(models.WorkerProfile, worker_id)
    if not issue or not worker:
        raise HTTPException(404, "Issue or worker not found")
    try:
        assignment = allocation.assign_worker(db, issue, worker, "ADMIN", admin, note)
    except ValueError as e:
        raise HTTPException(409, str(e))

    workflow.add_event(
        db,
        issue,
        admin,
        "ASSIGNED",
        f"Manual assignment → {worker.user.name} (score {assignment.score:.1f}).{' Note: ' + note if note else ''}",
    )
    workflow.notify(
        db,
        worker.user_id,
        f"New job assigned: {issue.ticket_no}",
        f"{issue.category.value} · {issue.address}",
        "WORKER_JOB",
        "/worker/jobs",
    )
    workflow.log_audit(db, "MANUAL_ASSIGN", admin, "ISSUE", issue.id, {"worker_id": worker.id, "note": note})
    db.commit()
    return {"ok": True, "score": assignment.score}


@router.post("/issues/{issue_id}/unassign")
def unassign_issue(
    issue_id: int,
    note: str = "",
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if not issue.assigned_worker_id:
        raise HTTPException(409, "Issue is not currently assigned")

    old_worker = db.get(models.WorkerProfile, issue.assigned_worker_id)
    if old_worker:
        old_worker.current_load = max(0, old_worker.current_load - 1)

    issue.assigned_worker_id = None
    issue.assigned_at = None
    if issue.status in (models.IssueStatus.ASSIGNED, models.IssueStatus.IN_PROGRESS):
        issue.status = models.IssueStatus.UNDER_REVIEW

    workflow.add_event(db, issue, admin, "UNASSIGNED", f"Issue unassigned by admin. {note}".strip())
    workflow.log_audit(db, "UNASSIGN_ISSUE", admin, "ISSUE", issue.id, {"previous_worker_id": old_worker.id if old_worker else None, "note": note})
    db.commit()
    return {"ok": True}


@router.post("/issues/{issue_id}/merge/{target_issue_id}")
def merge_duplicate(
    issue_id: int,
    target_issue_id: int,
    reason: str = "",
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """PRD Page 5 & Page 8: Admin-approved duplicate merge preserving master defect and citizen reports."""
    source_issue = db.get(models.Issue, issue_id)
    target_issue = db.get(models.Issue, target_issue_id)
    if not source_issue or not target_issue:
        raise HTTPException(404, "Issue not found")
    try:
        workflow.merge_master_issues(db, source_issue, target_issue, admin, reason)
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"ok": True, "target_report_count": target_issue.report_count, "target_priority_score": target_issue.priority_score}


@router.post("/issues/{issue_id}/unmerge")
def unmerge_duplicate(
    issue_id: int,
    reason: str = "",
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """PRD Page 5: Separate incorrectly merged issues."""
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    try:
        workflow.unmerge_master_issue(db, issue, admin, reason)
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"ok": True, "status": issue.status.value}


@router.get("/verification-queue")
def verification_queue(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    storage = get_storage()
    issues = db.query(models.Issue).filter(models.Issue.status == models.IssueStatus.PENDING_VERIFICATION).order_by(models.Issue.updated_at.desc()).all()
    out = []
    for issue in issues:
        media_list = [{"id": m.id, "type": m.type, "url": storage.url(m.storage_key), "caption": m.caption} for m in (issue.media or [])]
        before_photo = next((m["url"] for m in media_list if m["type"] == "BEFORE"), None)
        after_photo = next((m["url"] for m in media_list if m["type"] == "AFTER"), None)

        latest_review = None
        if issue.verifications:
            vr = sorted(issue.verifications, key=lambda x: x.created_at, reverse=True)[0]
            latest_review = {
                "outcome": vr.outcome,
                "confidence": vr.confidence,
                "explanation": vr.explanation,
                "limitations": vr.limitations,
                "provider": vr.provider,
                "model": vr.model,
            }

        worker_name = issue.assigned_worker.user.name if issue.assigned_worker and issue.assigned_worker.user else "Unknown worker"

        out.append({
            "id": issue.id,
            "ticket_no": issue.ticket_no,
            "category": issue.category.value,
            "description": issue.description,
            "address": issue.address,
            "zone": issue.zone,
            "priority": issue.priority.value,
            "priority_score": issue.priority_score,
            "report_count": issue.report_count,
            "rework_count": issue.rework_count,
            "worker_name": worker_name,
            "before_photo": before_photo,
            "after_photo": after_photo,
            "media": media_list,
            "ai_review": latest_review,
            "updated_at": issue.updated_at.isoformat() if issue.updated_at else None,
        })
    return out


class VerificationDecision(BaseModel):
    decision: str  # APPROVED | REWORK_REQUESTED
    note: str = ""


@router.post("/issues/{issue_id}/verification")
def decide_verification(
    issue_id: int,
    body: VerificationDecision,
    db: Session = Depends(get_db),
    admin: models.User = Depends(require_admin),
):
    """PRD Page 6 & 7: Mandatory final verification. AI output is advisory; Admin retains final authority."""
    issue = db.get(models.Issue, issue_id)
    if not issue:
        raise HTTPException(404, "Issue not found")
    if issue.status != models.IssueStatus.PENDING_VERIFICATION:
        raise HTTPException(409, f"Only PENDING_VERIFICATION issues can be decided (current: {issue.status.value})")

    review = (
        db.query(models.VerificationReview)
        .filter(models.VerificationReview.issue_id == issue_id, models.VerificationReview.admin_decision.is_(None))
        .order_by(models.VerificationReview.created_at.desc())
        .first()
    )

    if body.decision == "APPROVED":
        if review:
            review.admin_decision = "APPROVED"
            review.admin_note = body.note.strip() or None
            review.decided_at = datetime.utcnow()
            review.decided_by = admin.id

        workflow.set_status(db, issue, models.IssueStatus.VERIFIED)
        workflow.add_event(
            db,
            issue,
            admin,
            "VERIFICATION_DECISION",
            f"Admin approved repair sign-off. Ticket officially closed.{' Note: ' + body.note.strip() if body.note.strip() else ''}",
            {"decision": "APPROVED", "note": body.note.strip()},
        )
        if issue.assigned_worker:
            issue.assigned_worker.jobs_completed += 1
            issue.assigned_worker.current_load = max(0, issue.assigned_worker.current_load - 1)

        workflow.notify(
            db,
            issue.reporter_id,
            f"Issue {issue.ticket_no} resolved and verified!",
            "Municipal administrator inspected and approved the repair work. Thank you for reporting!",
            "VERIFIED",
            "/citizen/reports",
        )
        workflow.log_audit(db, "APPROVE_VERIFICATION", admin, "ISSUE", issue.id, {"note": body.note.strip()})

    elif body.decision == "REWORK_REQUESTED":
        if len(body.note.strip()) < 5:
            raise HTTPException(422, "A specific rework reason (at least 5 characters) is required")

        if review:
            review.admin_decision = "REWORK_REQUESTED"
            review.admin_note = body.note.strip()
            review.decided_at = datetime.utcnow()
            review.decided_by = admin.id

        issue.rework_count += 1
        workflow.set_status(db, issue, models.IssueStatus.REWORK_REQUIRED)
        workflow.add_event(
            db,
            issue,
            admin,
            "REWORK_REQUESTED",
            f"Admin requested repair rework. Instructions: {body.note.strip()}",
            {"rework_count": issue.rework_count, "instructions": body.note.strip()},
        )
        if issue.assigned_worker:
            workflow.notify(
                db,
                issue.assigned_worker.user_id,
                f"Rework requested on {issue.ticket_no}",
                f"Instructions: {body.note.strip()}",
                "REWORK",
                "/worker/rework",
            )
        workflow.notify(
            db,
            issue.reporter_id,
            f"Quality check update on {issue.ticket_no}",
            "Repair evidence did not pass quality check — municipal crew dispatched for rework.",
            "REWORK",
            "/citizen/reports",
        )
        workflow.log_audit(db, "REQUEST_REWORK", admin, "ISSUE", issue.id, {"note": body.note.strip(), "rework_count": issue.rework_count})
    else:
        raise HTTPException(422, "decision must be APPROVED or REWORK_REQUESTED")

    db.commit()
    return {"ok": True, "status": issue.status.value}


@router.get("/audit-logs")
def audit_logs(limit: int = 100, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    logs = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc()).limit(limit).all()
    return [
        {
            "id": l.id,
            "action": l.action,
            "actor_name": l.actor_name,
            "actor_role": l.actor_role,
            "target_type": l.target_type,
            "target_id": l.target_id,
            "details": l.details,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in logs
    ]


@router.get("/analytics")
def analytics(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """PRD Page 5: Real database-backed metrics without fabricated values."""
    now = datetime.utcnow()
    two_weeks_ago = now - timedelta(days=14)

    recent_issues = db.query(models.Issue).filter(models.Issue.created_at >= two_weeks_ago).all()
    by_day_map = {}
    for i in range(14):
        d = (two_weeks_ago + timedelta(days=i + 1)).strftime("%Y-%m-%d")
        by_day_map[d] = 0
    for issue in recent_issues:
        if issue.created_at:
            d = issue.created_at.strftime("%Y-%m-%d")
            if d in by_day_map:
                by_day_map[d] += 1

    by_day = [{"date": k, "count": v} for k, v in sorted(by_day_map.items())]

    # Average resolution time
    resolved = db.query(models.Issue).filter(models.Issue.verified_at.isnot(None), models.Issue.created_at.isnot(None)).all()
    avg_hours = 0.0
    if resolved:
        avg_hours = round(sum((i.verified_at - i.created_at).total_seconds() / 3600.0 for i in resolved) / len(resolved), 1)

    # Rework rate
    total_audited = db.query(models.Issue).filter(models.Issue.status.in_([models.IssueStatus.VERIFIED, models.IssueStatus.REWORK_REQUIRED])).count()
    total_reworked = db.query(models.Issue).filter(models.Issue.rework_count > 0).count()
    rework_rate = round((total_reworked / total_audited) * 100, 1) if total_audited > 0 else 0.0

    # Duplicate detection rate
    total_reports = db.query(func.coalesce(func.sum(models.Issue.report_count), 0)).scalar() or 0
    total_master = db.query(models.Issue).count()
    dup_savings = max(0, total_reports - total_master)

    return {
        "by_day": by_day,
        "avg_resolution_hours": avg_hours,
        "rework_rate_pct": rework_rate,
        "duplicate_savings_count": dup_savings,
        "total_master_issues": total_master,
        "total_citizen_reports": total_reports,
    }
