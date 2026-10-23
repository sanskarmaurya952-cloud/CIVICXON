"""Seed CIVICXON database with departments, zones, demo users, demo workers and demo issues.

Usage:  python -m scripts.seed (from backend/ or repo root)
Demo passwords (development only): Civicxon@2026 for all seeded accounts.
"""
import sys
import os

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from datetime import datetime, timedelta
from app.database import SessionLocal, engine
from app import models
from app.security import hash_password
from app.services.priority import calculate_priority_score

DEMO_PASSWORD = "Civicxon@2026"


def seed():
    # Automatically ensure tables exist
    models.Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if db.query(models.User).filter(models.User.email == "admin@civicxon.gov").first():
            print("Database already seeded with demo accounts — skipping.")
            return

        print("Seeding CIVICXON database...")

        # Departments
        dept_road = db.query(models.Department).filter(models.Department.code == "ROAD").first()
        if not dept_road:
            dept_road = models.Department(
                code="ROAD",
                name="Road Maintenance Department",
                handles=["pothole"],
                description="Potholes, road subsidence, surface erosion, and asphalt defects.",
                demo_integration=True,
                contact_email="roads@civicxon.gov.demo",
                head="Eng. Vikram Malhotra",
            )
            db.add(dept_road)

        dept_street = db.query(models.Department).filter(models.Department.code == "STREET").first()
        if not dept_street:
            dept_street = models.Department(
                code="STREET",
                name="Streetlight Maintenance Department",
                handles=["streetlight"],
                description="Luminaire faults, light pole structural damage, wiring, and dark stretches.",
                demo_integration=True,
                contact_email="streetlights@civicxon.gov.demo",
                head="Eng. Meena Krishnan",
            )
            db.add(dept_street)
        db.flush()

        # Zones
        zones_data = [
            ("Central", 12.9716, 77.5946),
            ("North", 13.0180, 77.5900),
            ("East", 12.9857, 77.6536),
            ("South", 12.9250, 77.5940),
            ("West", 12.9665, 77.5120),
        ]
        existing_zone_names = {z.name for z in db.query(models.Zone).all()}
        for name, lat, lng in zones_data:
            if name not in existing_zone_names:
                z = models.Zone(name=name, lat=lat, lng=lng, radius_km=4.0)
                db.add(z)
        db.flush()

        # Accounts
        accounts = [
            ("Admin Priya Sharma", "admin@civicxon.gov", "admin"),
            ("Rohan Mehta", "citizen@civicxon.gov", "citizen"),
            ("Suresh Yadav", "worker@civicxon.gov", "worker"),
            ("Anil Menon", "a.menon@civicxon.gov", "citizen"),
            ("Deepak Rao", "w.rao@civicxon.gov", "worker"),
            ("Imran Khan", "w.khan@civicxon.gov", "worker"),
            ("Lakshmi Iyer", "w.iyer@civicxon.gov", "worker"),
            ("George Thomas", "w.thomas@civicxon.gov", "worker"),
            ("Divya Nair", "w.nair@civicxon.gov", "worker"),
            ("Hiren Patel", "w.patel@civicxon.gov", "worker"),
            ("Kiran Reddy", "w.reddy@civicxon.gov", "worker"),
        ]
        user_ids = {}
        for name, email, role in accounts:
            u = models.User(
                name=name,
                email=email,
                phone="+91 98000 00001",
                role=models.Role(role),
                password_hash=hash_password(DEMO_PASSWORD),
            )
            db.add(u)
            db.flush()
            user_ids[email] = u.id

        # Workers
        workers_data = [
            ("worker@civicxon.gov", dept_road, ["road_maintenance"], ["Central", "North"], "AVAILABLE", 1, 4.8, 12.973, 77.596),
            ("w.rao@civicxon.gov", dept_road, ["road_maintenance"], ["East", "Central"], "AVAILABLE", 2, 4.6, 12.9845, 77.651),
            ("w.khan@civicxon.gov", dept_road, ["road_maintenance"], ["West"], "BUSY", 2, 4.3, 12.968, 77.516),
            ("w.iyer@civicxon.gov", dept_road, ["road_maintenance"], ["South", "Central"], "AVAILABLE", 0, 4.9, 12.926, 77.591),
            ("w.thomas@civicxon.gov", dept_street, ["streetlight_maintenance"], ["Central", "South"], "AVAILABLE", 1, 4.7, 12.972, 77.601),
            ("w.nair@civicxon.gov", dept_street, ["streetlight_maintenance"], ["North", "East"], "AVAILABLE", 1, 4.5, 13.014, 77.588),
            ("w.patel@civicxon.gov", dept_street, ["streetlight_maintenance"], ["West", "South"], "OFFLINE", 0, 4.1, 12.961, 77.509),
            ("w.reddy@civicxon.gov", dept_street, ["streetlight_maintenance"], ["Central", "East"], "AVAILABLE", 2, 4.4, 12.981, 77.655),
        ]
        for email, dept, skills, zonelist, availability, load, rating, lat, lng in workers_data:
            profile = models.WorkerProfile(
                user_id=user_ids[email],
                department_id=dept.id,
                skills=skills,
                zones=zonelist,
                availability=availability,
                current_load=load,
                max_concurrent_jobs=3,
                rating=rating,
                jobs_completed=96,
                base_lat=lat,
                base_lng=lng,
            )
            db.add(profile)
        db.flush()

        # Seed Issue 1 (PENDING_VERIFICATION with Before and After media)
        suresh = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user_ids["worker@civicxon.gov"]).one()
        now = datetime.utcnow()
        created_time = now - timedelta(days=6)

        prio_result = calculate_priority_score(
            category="pothole",
            severity="severe",
            address="100 Feet Road, Indiranagar, Bengaluru",
            zone="Central",
            lat=12.9758,
            lng=77.6045,
            description="Deep pothole near the signal junction on 100 Feet Road. Two-wheelers keep swerving into the bus lane.",
            report_count=2,
            created_at=created_time,
        )

        issue1 = models.Issue(
            ticket_no="CX-2026-0001",
            category=models.IssueCategory.pothole,
            description="Deep pothole near the signal junction on 100 Feet Road. Two-wheelers keep swerving into the bus lane.",
            status=models.IssueStatus.PENDING_VERIFICATION,
            priority=models.Priority(prio_result["band"]),
            priority_score=prio_result["score"],
            priority_band=prio_result["band"],
            priority_breakdown=prio_result["factors"],
            priority_reason=prio_result["explanation"],
            reporter_id=user_ids["citizen@civicxon.gov"],
            address="100 Feet Road, Indiranagar, Bengaluru",
            lat=12.9758,
            lng=77.6045,
            zone="Central",
            department_id=dept_road.id,
            assigned_worker_id=suresh.id,
            report_count=2,
            ai_analysis={
                "provider": "gemma-4",
                "category": "pothole",
                "severity": "severe",
                "confidence": 0.88,
                "riskIndicators": ["Two-wheeler hazard", "High-traffic corridor"],
                "explanation": "Deep, water-filled pothole on lane edge; elevated two-wheeler risk on a busy corridor.",
                "departmentSuggestion": "Road Maintenance Department",
            },
            created_at=created_time,
            assigned_at=now - timedelta(days=5),
            started_at=now - timedelta(days=4),
        )
        db.add(issue1)
        db.flush()

        # Media before & after
        m_before = models.Media(
            issue_id=issue1.id,
            type="BEFORE",
            storage_key="seed/pothole_before.jpg",
            caption="Citizen report: deep road crater near bus stop",
            uploaded_by=user_ids["citizen@civicxon.gov"],
            uploaded_at=created_time,
        )
        m_after = models.Media(
            issue_id=issue1.id,
            type="AFTER",
            storage_key="seed/pothole_after.jpg",
            caption="Worker repair: asphalt patched, compacted and sealed",
            uploaded_by=user_ids["worker@civicxon.gov"],
            uploaded_at=now - timedelta(hours=3),
        )
        db.add_all([m_before, m_after])
        db.flush()

        # Citizen Reports linked to Issue 1 (PRD: ONE PHYSICAL DEFECT = ONE MASTER ISSUE)
        cr1 = models.CitizenReport(
            issue_id=issue1.id,
            reporter_id=user_ids["citizen@civicxon.gov"],
            ticket_no="CX-2026-0001-R1",
            description="Deep pothole near the signal junction on 100 Feet Road. Two-wheelers keep swerving into the bus lane.",
            category=models.IssueCategory.pothole,
            lat=12.9758,
            lng=77.6045,
            address="100 Feet Road, Indiranagar, Bengaluru",
            media_storage_key="seed/pothole_before.jpg",
            status="ORIGINAL_MASTER",
            created_at=created_time,
        )
        cr2 = models.CitizenReport(
            issue_id=issue1.id,
            reporter_id=user_ids["a.menon@civicxon.gov"],
            ticket_no="CX-2026-0001-R2",
            description="Danger crater on 100 Feet road near signal, witnessed a cyclist almost fall.",
            category=models.IssueCategory.pothole,
            lat=12.9759,
            lng=77.6046,
            address="100 Feet Road, near signal, Indiranagar",
            media_storage_key="seed/pothole_before.jpg",
            status="LINKED",
            created_at=created_time + timedelta(hours=6),
        )
        db.add_all([cr1, cr2])

        # Verification Review (AI Advisory)
        review1 = models.VerificationReview(
            issue_id=issue1.id,
            provider="gemma-4",
            model="gemma-4-26b-a4b-it",
            outcome="likely_resolved",
            explanation="The asphalt patch completely covers the void with a sealed perimeter. No remaining depression observed.",
            limitations="Single viewpoint camera comparison; subterranean sub-base compaction cannot be verified from 2D imagery.",
            confidence=0.91,
            comparison_media_ids=[m_before.id, m_after.id],
            reviewer_name="Suresh Yadav",
            created_at=now - timedelta(hours=3),
        )
        db.add(review1)

        # Assignment record
        db.add(models.Assignment(
            issue_id=issue1.id,
            worker_id=suresh.id,
            score=91.5,
            breakdown={"skill": 100, "distance": 92, "workload": 66.7, "availability": 100, "distance_km": 0.9},
            reason="skill 100 · 0.9 km · load 1/3 · available ⇒ 91.5",
            source="AUTO",
            status="ACTIVE",
            created_at=now - timedelta(days=5),
        ))

        # Events
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="Rohan Mehta", actor_role="citizen", type="CREATED", message="Citizen reported the issue with photo evidence."))
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="CivicXon System", actor_role="system", type="AI_ANALYSIS", message="AI analysis (gemma-4): pothole · severe · confidence 0.88"))
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="CivicXon System", actor_role="system", type="REPORT_LINKED", message="Citizen report CX-2026-0001-R2 by Anil Menon linked as confirmed duplicate (Report count: 2)."))
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="CivicXon System", actor_role="system", type="ASSIGNED", message="Auto-assigned to Suresh Yadav."))
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="Suresh Yadav", actor_role="worker", type="WORK_STARTED", message="Worker arrived on site and started repair work."))
        db.add(models.IssueEvent(issue_id=issue1.id, actor_name="Suresh Yadav", actor_role="worker", type="EVIDENCE_SUBMITTED", message="Worker submitted after-repair photo evidence. AI pre-check: LIKELY RESOLVED."))

        # Audit log
        db.add(models.AuditLog(
            action="SEED_DATABASE",
            actor_name="CivicXon System",
            actor_role="system",
            target_type="SYSTEM",
            details={"seeded_records": len(accounts)},
        ))

        db.commit()
        print("Successfully seeded CIVICXON database!")
        print("  - 2 departments (Road, Streetlight)")
        print("  - 5 zones (Central, North, East, South, West)")
        print(f"  - {len(accounts)} users, {len(workers_data)} workers")
        print("  - 1 master issue CX-2026-0001 (PENDING_VERIFICATION) with 2 linked citizen reports")
        print("  - Demo credentials: admin@civicxon.gov / citizen@civicxon.gov / worker@civicxon.gov (Civicxon@2026)")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
