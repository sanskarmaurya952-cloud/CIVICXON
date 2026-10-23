from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float, JSON, Enum, Index, event,
)
from sqlalchemy.orm import declarative_base, relationship
import enum
from .config import settings

Base = declarative_base()


class Role(str, enum.Enum):
    citizen = "citizen"
    worker = "worker"
    admin = "admin"


class IssueStatus(str, enum.Enum):
    REPORTED = "REPORTED"
    UNDER_REVIEW = "UNDER_REVIEW"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    VERIFIED = "VERIFIED"
    REJECTED = "REJECTED"
    DUPLICATE = "DUPLICATE"
    REWORK_REQUIRED = "REWORK_REQUIRED"
    CANCELLED = "CANCELLED"


class Priority(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class IssueCategory(str, enum.Enum):
    pothole = "pothole"
    streetlight = "streetlight"


VALID_TRANSITIONS = {
    IssueStatus.REPORTED: {IssueStatus.UNDER_REVIEW, IssueStatus.REJECTED, IssueStatus.DUPLICATE, IssueStatus.CANCELLED},
    IssueStatus.UNDER_REVIEW: {IssueStatus.ASSIGNED, IssueStatus.REJECTED, IssueStatus.DUPLICATE, IssueStatus.CANCELLED},
    IssueStatus.ASSIGNED: {IssueStatus.IN_PROGRESS, IssueStatus.ASSIGNED, IssueStatus.UNDER_REVIEW, IssueStatus.CANCELLED, IssueStatus.REWORK_REQUIRED},
    IssueStatus.IN_PROGRESS: {IssueStatus.PENDING_VERIFICATION, IssueStatus.REWORK_REQUIRED, IssueStatus.CANCELLED, IssueStatus.ASSIGNED},
    IssueStatus.PENDING_VERIFICATION: {IssueStatus.VERIFIED, IssueStatus.REWORK_REQUIRED, IssueStatus.ASSIGNED},
    IssueStatus.VERIFIED: set(),
    IssueStatus.REJECTED: set(),
    IssueStatus.DUPLICATE: {IssueStatus.UNDER_REVIEW},
    IssueStatus.REWORK_REQUIRED: {IssueStatus.IN_PROGRESS, IssueStatus.ASSIGNED, IssueStatus.PENDING_VERIFICATION},
    IssueStatus.CANCELLED: set(),
}


def _get_spatial_col():
    if settings.DATABASE_URL.startswith("postgres"):
        try:
            from geoalchemy2 import Geography
            return Geography(geometry_type="POINT", srid=4326)
        except Exception:
            return String(64)
    return String(64)


class Department(Base):
    __tablename__ = "departments"
    id = Column(Integer, primary_key=True)
    code = Column(String(16), unique=True, nullable=False)
    name = Column(String(160), nullable=False)
    description = Column(Text, default="")
    handles = Column(JSON, nullable=False, default=list)  # ["pothole"]
    demo_integration = Column(Boolean, default=True)
    contact_email = Column(String(160), default="")
    head = Column(String(120), default="")
    workers = relationship("WorkerProfile", back_populates="department")


class Zone(Base):
    __tablename__ = "zones"
    id = Column(Integer, primary_key=True)
    name = Column(String(80), unique=True, nullable=False)
    lat = Column(Float, nullable=False, default=12.9716)
    lng = Column(Float, nullable=False, default=77.5946)
    center = Column(_get_spatial_col(), nullable=True)
    radius_km = Column(Float, default=4.0)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(160), nullable=False)
    email = Column(String(190), unique=True, index=True, nullable=False)
    phone = Column(String(32), default="")
    role = Column(Enum(Role, name="user_role"), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    active = Column(Boolean, default=True, index=True)
    failed_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)
    worker_profile = relationship("WorkerProfile", back_populates="user", uselist=False)
    citizen_reports = relationship("CitizenReport", back_populates="reporter")


class WorkerProfile(Base):
    __tablename__ = "worker_profiles"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=False)
    skills = Column(JSON, nullable=False, default=list)  # ["road_maintenance", ...]
    zones = Column(JSON, nullable=False, default=list)   # ["Central", ...]
    availability = Column(String(16), default="AVAILABLE", index=True)
    current_load = Column(Integer, default=0)
    max_concurrent_jobs = Column(Integer, default=3)
    rating = Column(Float, default=4.5)
    jobs_completed = Column(Integer, default=0)
    base_lat = Column(Float, nullable=False, default=12.9716)
    base_lng = Column(Float, nullable=False, default=77.5946)
    base_location = Column(_get_spatial_col(), nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="worker_profile")
    department = relationship("Department", back_populates="workers")


class Issue(Base):
    __tablename__ = "issues"
    id = Column(Integer, primary_key=True)
    ticket_no = Column(String(32), unique=True, index=True, nullable=False)
    category = Column(Enum(IssueCategory, name="issue_category"), nullable=False, index=True)
    description = Column(Text, nullable=False)
    status = Column(Enum(IssueStatus, name="issue_status"), default=IssueStatus.REPORTED, index=True)
    priority = Column(Enum(Priority, name="issue_priority"), default=Priority.MEDIUM, index=True)
    priority_score = Column(Float, default=50.0, index=True)
    priority_band = Column(String(16), default="MEDIUM", index=True)
    priority_breakdown = Column(JSON, nullable=True)
    priority_override = Column(JSON, nullable=True)
    priority_reason = Column(Text, nullable=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    address = Column(String(320), default="")
    lat = Column(Float, nullable=False, default=12.9716)
    lng = Column(Float, nullable=False, default=77.5946)
    location = Column(_get_spatial_col(), nullable=True)
    zone = Column(String(80), index=True)
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    assigned_worker_id = Column(Integer, ForeignKey("worker_profiles.id"), nullable=True, index=True)
    duplicate_of_id = Column(Integer, ForeignKey("issues.id"), nullable=True)
    report_count = Column(Integer, default=1)
    ai_analysis = Column(JSON, nullable=True)
    rejected_reason = Column(Text, nullable=True)
    rework_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    assigned_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)

    reporter = relationship("User", foreign_keys=[reporter_id])
    assigned_worker = relationship("WorkerProfile")
    department = relationship("Department")
    media = relationship("Media", back_populates="issue", cascade="all, delete-orphan")
    events = relationship("IssueEvent", back_populates="issue", cascade="all, delete-orphan")
    assignments = relationship("Assignment", back_populates="issue")
    citizen_reports = relationship("CitizenReport", back_populates="issue", cascade="all, delete-orphan")
    verifications = relationship("VerificationReview", back_populates="issue", cascade="all, delete-orphan")


class CitizenReport(Base):
    """PRD Page 3 & Page 11: One physical defect = One master issue.
    Multiple citizen submissions link to the master issue as CitizenReport records.
    """
    __tablename__ = "citizen_reports"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="SET NULL"), nullable=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ticket_no = Column(String(32), index=True, nullable=False)
    description = Column(Text, nullable=False)
    category = Column(Enum(IssueCategory, name="report_category"), nullable=False)
    lat = Column(Float, nullable=False)
    lng = Column(Float, nullable=False)
    address = Column(String(320), default="")
    media_storage_key = Column(String(512), nullable=True)
    phash = Column(String(128), nullable=True)
    status = Column(String(32), default="LINKED")  # ORIGINAL_MASTER | LINKED | PENDING_REVIEW | REJECTED
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    issue = relationship("Issue", back_populates="citizen_reports")
    reporter = relationship("User", back_populates="citizen_reports")


class Media(Base):
    __tablename__ = "issue_media"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(8), nullable=False)  # BEFORE | AFTER
    storage_key = Column(String(512), nullable=False)  # object key, never bytes
    caption = Column(String(255), default="")
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    phash = Column(String(128), nullable=True)
    issue = relationship("Issue", back_populates="media")


class Assignment(Base):
    __tablename__ = "assignments"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    worker_id = Column(Integer, ForeignKey("worker_profiles.id"), nullable=False)
    score = Column(Float, nullable=False)
    breakdown = Column(JSON, nullable=False)  # {skill, distance, workload, availability, distance_km}
    reason = Column(Text, nullable=False)
    source = Column(String(8), nullable=False)  # AUTO | ADMIN
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(16), default="ACTIVE", index=True)  # ACTIVE | SUPERSEDED
    created_at = Column(DateTime, default=datetime.utcnow)
    issue = relationship("Issue", back_populates="assignments")
    worker = relationship("WorkerProfile")


class IssueEvent(Base):
    __tablename__ = "issue_events"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id", ondelete="CASCADE"), nullable=False, index=True)
    at = Column(DateTime, default=datetime.utcnow, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_name = Column(String(160), default="CivicXon System")
    actor_role = Column(String(16), default="system")
    type = Column(String(32), nullable=False, index=True)
    message = Column(Text, nullable=False)
    meta = Column(JSON, nullable=True)
    issue = relationship("Issue", back_populates="events")


class VerificationReview(Base):
    __tablename__ = "verification_reviews"
    id = Column(Integer, primary_key=True)
    issue_id = Column(Integer, ForeignKey("issues.id"), nullable=False, index=True)
    provider = Column(String(16), nullable=False)  # gemma-4 | heuristic | mock-dev
    model = Column(String(64), nullable=True)
    outcome = Column(String(24), nullable=False)   # likely_resolved | not_resolved | uncertain
    explanation = Column(Text, default="")
    limitations = Column(Text, default="")
    confidence = Column(Float, default=0.5)
    comparison_media_ids = Column(JSON, default=list)
    reviewer_name = Column(String(160), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    admin_decision = Column(String(24), nullable=True)  # APPROVED | REWORK_REQUESTED
    admin_note = Column(Text, nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decided_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    issue = relationship("Issue", back_populates="verifications")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(190), nullable=False)
    body = Column(Text, default="")
    type = Column(String(32), default="GENERAL")
    read = Column(Boolean, default=False, index=True)
    at = Column(DateTime, default=datetime.utcnow)
    link = Column(String(255), nullable=True)


class AuditLog(Base):
    """PRD Page 11 & Page 13: Audit trail for administrative decisions, merges, priority overrides."""
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True)
    action = Column(String(64), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_name = Column(String(160), default="CivicXon System")
    actor_role = Column(String(16), default="system")
    target_type = Column(String(32), nullable=False, index=True)  # ISSUE | WORKER | USER | CONFIG
    target_id = Column(Integer, nullable=True, index=True)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
