import csv
import io
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from .. import models
from ..database import get_db
from ..security import require_admin, hash_password

router = APIRouter(prefix="/api/workers", tags=["workers"])


def _worker_row(db: Session, w: models.WorkerProfile, u: models.User):
    base = db.execute(text("SELECT ST_Y(base_location::geometry), ST_X(base_location::geometry) FROM worker_profiles WHERE id=:i"), {"i": w.id}).one()
    return {
        "id": w.id, "user_id": u.id, "name": u.name, "email": u.email, "phone": u.phone, "active": u.active,
        "department_id": w.department_id, "skills": w.skills, "zones": w.zones,
        "availability": w.availability, "current_load": w.current_load, "max_concurrent_jobs": w.max_concurrent_jobs,
        "rating": w.rating, "jobs_completed": w.jobs_completed, "base_lat": base[0], "base_lng": base[1],
    }


@router.get("")
def list_workers(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    rows = db.query(models.WorkerProfile, models.User).join(models.User, models.User.id == models.WorkerProfile.user_id).all()
    return [_worker_row(db, w, u) for w, u in rows]


class WorkerIn(BaseModel):
    name: str
    email: str
    phone: str
    password: str
    department_id: int
    skills: list[str]
    zones: list[str]
    availability: str = "AVAILABLE"
    max_concurrent_jobs: int = 3
    base_lat: float = 12.9716
    base_lng: float = 77.5946


@router.post("", status_code=201)
def create_worker(body: WorkerIn, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    if db.query(models.User).filter(models.User.email == body.email.strip().lower()).first():
        raise HTTPException(409, "Email already in use")
    if len(body.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    dept = db.query(models.Department).get(body.department_id)
    if not dept:
        raise HTTPException(404, "Department not found")
    user = models.User(name=body.name.strip(), email=body.email.strip().lower(), phone=body.phone.strip(),
                       role=models.Role.worker, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    profile = models.WorkerProfile(user_id=user.id, department_id=dept.id, skills=body.skills, zones=body.zones,
                                   availability=body.availability, max_concurrent_jobs=body.max_concurrent_jobs)
    db.add(profile)
    db.flush()
    db.execute(text("UPDATE worker_profiles SET base_location = ST_GeogFromText(:pt) WHERE id = :i"),
               {"pt": f"SRID=4326;POINT({body.base_lng} {body.base_lat})", "i": profile.id})
    db.commit()
    return {"id": profile.id, "user_id": user.id}


class WorkerPatch(BaseModel):
    skills: list[str] | None = None
    zones: list[str] | None = None
    availability: str | None = None
    max_concurrent_jobs: int | None = None
    rating: float | None = None
    base_lat: float | None = None
    base_lng: float | None = None
    department_id: int | None = None


@router.patch("/{worker_id}")
def update_worker(worker_id: int, body: WorkerPatch, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    profile = db.query(models.WorkerProfile).get(worker_id)
    if not profile:
        raise HTTPException(404, "Worker not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(profile, field, value)
    if body.base_lat is not None and body.base_lng is not None:
        db.execute(text("UPDATE worker_profiles SET base_location = ST_GeogFromText(:pt) WHERE id = :i"),
                   {"pt": f"SRID=4326;POINT({body.base_lng} {body.base_lat})", "i": profile.id})
    db.commit()
    return {"ok": True}


@router.post("/{worker_id}/active/{active}")
def set_active(worker_id: int, active: bool, db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    profile = db.query(models.WorkerProfile).get(worker_id)
    if not profile:
        raise HTTPException(404, "Worker not found")
    profile.user.active = active
    if not active:
        profile.availability = "OFFLINE"
    db.commit()
    return {"ok": True, "active": active}


@router.post("/import")
def import_workers(file: UploadFile = File(...), db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    """CSV import — validated row-by-row; bad rows reported, good rows committed."""
    content = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(content))
    created, errors = 0, []
    dept_by_code = {d.code.lower(): d for d in db.query(models.Department).all()}
    zone_names = {z.name for z in db.query(models.Zone).all()}
    for i, row in enumerate(reader, start=2):
        try:
            name, email = (row.get("name") or "").strip(), (row.get("email") or "").strip().lower()
            dept_key = (row.get("department") or "").strip().lower()
            skills = [s.strip().lower() for s in (row.get("skills") or "").split("|") if s.strip()]
            zones = [z.strip() for z in (row.get("zones") or "").split("|") if z.strip()]
            if len(name) < 3: raise ValueError("name too short")
            if "@" not in email: raise ValueError("invalid email")
            dept = dept_by_code.get(dept_key) or db.query(models.Department).filter(models.Department.id == dept_key).first()
            if not dept: raise ValueError(f"unknown department {dept_key!r} (use ROAD or STREET)")
            if not skills: raise ValueError("at least one skill required")
            for z in zones:
                if z not in zone_names: raise ValueError(f"unknown zone {z!r}")
            password = row.get("password") or "Civicxon@2026"
            if db.query(models.User).filter(models.User.email == email).first():
                raise ValueError("duplicate email")
            user = models.User(name=name, email=email, phone=(row.get("phone") or ""), role=models.Role.worker, password_hash=hash_password(password))
            db.add(user)
            db.flush()
            profile = models.WorkerProfile(user_id=user.id, department_id=dept.id, skills=skills, zones=zones,
                                           availability=(row.get("availability") or "AVAILABLE").upper(),
                                           max_concurrent_jobs=int(row.get("maxjobs") or 3),
                                           base_location=text("ST_GeogFromText(:pt)").bindparams(pt=f"SRID=4326;POINT({float(row.get('baselng') or 77.5946)} {float(row.get('baselat') or 12.9716)})"))
            db.add(profile)
            created += 1
        except Exception as exc:
            errors.append({"row": i, "message": str(exc)})
    db.commit()
    return {"created": created, "skipped": len(errors), "errors": errors}


@router.get("/export")
def export_workers(db: Session = Depends(get_db), admin: models.User = Depends(require_admin)):
    rows = db.query(models.WorkerProfile, models.User).join(models.User, models.User.id == models.WorkerProfile.user_id).all()
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["name", "email", "phone", "department", "skills", "zones", "availability", "maxJobs", "rating", "jobsCompleted"])
    dept_code = {d.id: d.code for d in db.query(models.Department).all()}
    for w, u in rows:
        writer.writerow([u.name, u.email, u.phone, dept_code.get(w.department_id, ""), "|".join(w.skills), "|".join(w.zones), w.availability, w.max_concurrent_jobs, w.rating, w.jobs_completed])
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=civicxon-workers.csv"})
