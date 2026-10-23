"""Initial schema — users, departments, zones, workers, issues, media, assignments, events, verifications, notifications

Revision ID: 0001_initial
Revises:
Create Date: 2026-10-22
"""
from alembic import op
import sqlalchemy as sa
import geoalchemy2

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

user_role = sa.Enum("citizen", "worker", "admin", name="user_role")
issue_category = sa.Enum("pothole", "streetlight", name="issue_category")
issue_status = sa.Enum("REPORTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "DUPLICATE", "REWORK_REQUIRED", "CANCELLED", name="issue_status")
issue_priority = sa.Enum("LOW", "MEDIUM", "HIGH", "CRITICAL", name="issue_priority")


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.create_table(
        "departments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(16), unique=True, nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
        sa.Column("handles", sa.JSON, nullable=False),
        sa.Column("demo_integration", sa.Boolean, server_default=sa.true()),
        sa.Column("contact_email", sa.String(160), server_default=""),
        sa.Column("head", sa.String(120), server_default=""),
    )
    op.create_table(
        "zones",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(80), unique=True, nullable=False),
        sa.Column("center", geoalchemy2.Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("radius_km", sa.Float, server_default="4.0"),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("email", sa.String(190), unique=True, nullable=False),
        sa.Column("phone", sa.String(32), server_default=""),
        sa.Column("role", user_role, nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("active", sa.Boolean, server_default=sa.true()),
        sa.Column("failed_attempts", sa.Integer, server_default="0"),
        sa.Column("locked_until", sa.DateTime, nullable=True),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("last_login_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"])
    op.create_index("ix_users_role", "users", ["role"])
    op.create_index("ix_users_active", "users", ["active"])
    op.create_table(
        "worker_profiles",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=False),
        sa.Column("skills", sa.JSON, nullable=False),
        sa.Column("zones", sa.JSON, nullable=False),
        sa.Column("availability", sa.String(16), server_default="AVAILABLE"),
        sa.Column("current_load", sa.Integer, server_default="0"),
        sa.Column("max_concurrent_jobs", sa.Integer, server_default="3"),
        sa.Column("rating", sa.Float, server_default="4.5"),
        sa.Column("jobs_completed", sa.Integer, server_default="0"),
        sa.Column("base_location", geoalchemy2.Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("joined_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_workers_availability", "worker_profiles", ["availability"])
    op.create_table(
        "issues",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("ticket_no", sa.String(32), unique=True, nullable=False),
        sa.Column("category", issue_category, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("status", issue_status, server_default="REPORTED"),
        sa.Column("priority", issue_priority, server_default="MEDIUM"),
        sa.Column("priority_reason", sa.Text, nullable=True),
        sa.Column("reporter_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("address", sa.String(320), server_default=""),
        sa.Column("location", geoalchemy2.Geography(geometry_type="POINT", srid=4326), nullable=False),
        sa.Column("zone", sa.String(80)),
        sa.Column("department_id", sa.Integer, sa.ForeignKey("departments.id"), nullable=True),
        sa.Column("assigned_worker_id", sa.Integer, sa.ForeignKey("worker_profiles.id"), nullable=True),
        sa.Column("duplicate_of_id", sa.Integer, sa.ForeignKey("issues.id"), nullable=True),
        sa.Column("ai_analysis", sa.JSON, nullable=True),
        sa.Column("rejected_reason", sa.Text, nullable=True),
        sa.Column("rework_count", sa.Integer, server_default="0"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("assigned_at", sa.DateTime, nullable=True),
        sa.Column("started_at", sa.DateTime, nullable=True),
        sa.Column("resolved_at", sa.DateTime, nullable=True),
        sa.Column("verified_at", sa.DateTime, nullable=True),
    )
    op.create_index("ix_issues_location", "issues", ["location"], postgresql_using="gist")
    op.create_index("ix_issues_status", "issues", ["status"])
    op.create_index("ix_issues_category", "issues", ["category"])
    op.create_index("ix_issues_priority", "issues", ["priority"])
    op.create_index("ix_issues_zone", "issues", ["zone"])
    op.create_index("ix_issues_reporter", "issues", ["reporter_id"])
    op.create_index("ix_issues_worker", "issues", ["assigned_worker_id"])
    op.create_index("ix_issues_created", "issues", ["created_at"])
    op.create_table(
        "issue_media",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("issue_id", sa.Integer, sa.ForeignKey("issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(8), nullable=False),
        sa.Column("storage_key", sa.String(512), nullable=False),
        sa.Column("caption", sa.String(255), server_default=""),
        sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id"), nullable=False),
        sa.Column("uploaded_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("phash", sa.String(128), nullable=True),
    )
    op.create_index("ix_media_issue", "issue_media", ["issue_id"])
    op.create_table(
        "assignments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("issue_id", sa.Integer, sa.ForeignKey("issues.id"), nullable=False),
        sa.Column("worker_id", sa.Integer, sa.ForeignKey("worker_profiles.id"), nullable=False),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("breakdown", sa.JSON, nullable=False),
        sa.Column("reason", sa.Text, nullable=False),
        sa.Column("source", sa.String(8), nullable=False),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(16), server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )
    op.create_index("ix_assignments_issue", "assignments", ["issue_id"])
    op.create_index("ix_assignments_status", "assignments", ["status"])
    op.create_table(
        "issue_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("issue_id", sa.Integer, sa.ForeignKey("issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("actor_id", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
        sa.Column("actor_name", sa.String(160), server_default="CivicXon System"),
        sa.Column("actor_role", sa.String(16), server_default="system"),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("meta", sa.JSON, nullable=True),
    )
    op.create_index("ix_events_issue", "issue_events", ["issue_id"])
    op.create_index("ix_events_at", "issue_events", ["at"])
    op.create_table(
        "verification_reviews",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("issue_id", sa.Integer, sa.ForeignKey("issues.id"), nullable=False),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("model", sa.String(64), nullable=True),
        sa.Column("outcome", sa.String(24), nullable=False),
        sa.Column("explanation", sa.Text, server_default=""),
        sa.Column("limitations", sa.Text, server_default=""),
        sa.Column("confidence", sa.Float, server_default="0.5"),
        sa.Column("comparison_media_ids", sa.JSON, nullable=True),
        sa.Column("reviewer_name", sa.String(160), server_default=""),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("admin_decision", sa.String(24), nullable=True),
        sa.Column("admin_note", sa.Text, nullable=True),
        sa.Column("decided_at", sa.DateTime, nullable=True),
        sa.Column("decided_by", sa.Integer, sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_verifications_issue", "verification_reviews", ["issue_id"])
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(190), nullable=False),
        sa.Column("body", sa.Text, server_default=""),
        sa.Column("type", sa.String(32), server_default="GENERAL"),
        sa.Column("read", sa.Boolean, server_default=sa.false()),
        sa.Column("at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("link", sa.String(255), nullable=True),
    )
    op.create_index("ix_notifications_user", "notifications", ["user_id", "read"])


def downgrade() -> None:
    for table in ["notifications", "verification_reviews", "issue_events", "assignments", "issue_media", "issues", "worker_profiles", "users", "zones", "departments"]:
        op.drop_table(table)
    for t in ("user_role", "issue_category", "issue_status", "issue_priority"):
        op.execute(f"DROP TYPE IF EXISTS {t}")
