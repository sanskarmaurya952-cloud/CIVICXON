"""Seed PostgreSQL with departments, zones, demo users, demo workers and demo issues.

Usage:  DATABASE_URL=postgresql+psycopg2://civicxon:civicxon@localhost:5432/civicxon python -m scripts.seed
Demo passwords (development only): Civicxon@2026 for all seeded accounts.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta
from sqlalchemy import text
from app.database import SessionLocal, engine
from app import models
from app.security import hash_password

DEMO_PASSWORD = "Civicxon@2026"


def seed():
    db = SessionLocal()
    try:
        if db.query(models.User).first():
            print("Database already seeded — skipping (drop tables to re-seed: alembic downgrade base)")
            return
        dept_road = models.Department(code="ROAD", name="Road Maintenance Department", handles=["pothole"], description="Potholes, cracks, subsidence. Simulated demo integration.", demo_integration=True, contact_email="roads@civicxon.gov.demo", head="Eng. Vikram Malhotra")
        dept_street = models.Department(code="STREET", name="Streetlight Maintenance Department", handles=["streetlight"], description="Luminaire faults, pole damage, wiring. Simulated demo integration.", demo_integration=True, contact_email="streetlights@civicxon.gov.demo", head="Eng. Meena Krishnan")
        db.add_all([dept_road, dept_street])
        zones = [("Central", 12.9716, 77.5946), ("North", 13.018, 77.59), ("East", 12.9857, 77.6536), ("South", 12.925, 77.594), ("West", 12.9665, 77.512)]
        for name, lat, lng in zones:
            db.execute(text("INSERT INTO zones (name, center, radius_km) VALUES (:n, ST_GeogFromText(:pt), 4.0)"), {"n": name, "pt": f"SRID=4326;POINT({lng} {lat})"})

        accounts = [("Admin Priya Sharma", "admin@civicxon.gov", "admin"), ("Rohan Mehta", "citizen@civicxon.gov", "citizen"), ("Suresh Yadav", "worker@civicxon.gov", "worker"), ("Anil Menon", "a.menon@civicxon.gov", "citizen"), ("Deepak Rao", "w.rao@civicxon.gov", "worker"), ("Imran Khan", "w.khan@civicxon.gov", "worker"), ("Lakshmi Iyer", "w.iyer@civicxon.gov", "worker"), ("George Thomas", "w.thomas@civicxon.gov", "worker"), ("Divya Nair", "w.nair@civicxon.gov", "worker"), ("Hiren Patel", "w.patel@civicxon.gov", "worker"), ("Kiran Reddy", "w.reddy@civicxon.gov", "worker")]
        user_ids = {}
        for name, email, role in accounts:
            u = models.User(name=name, email=email, phone="+91 98000 00001", role=models.Role(role), password_hash=hash_password(DEMO_PASSWORD))
            db.add(u)
            db.flush()
            user_ids[email] = u.id

        workers = [
            ("worker@civicxon.gov", dept_road, ["road_maintenance"], ["Central", "North"], "AVAILABLE", 1, 4.8, 12.973, 77.596),
            ("w.rao@civicxon.gov", dept_road, ["road_maintenance"], ["East", "Central"], "AVAILABLE", 2, 4.6, 12.9845, 77.651),
            ("w.khan@civicxon.gov", dept_road, ["road_maintenance"], ["West"], "BUSY", 2, 4.3, 12.968, 77.516),
            ("w.iyer@civicxon.gov", dept_road, ["road_maintenance"], ["South", "Central"], "AVAILABLE", 0, 4.9, 12.926, 77.591),
            ("w.thomas@civicxon.gov", dept_street, ["streetlight_maintenance"], ["Central", "South"], "AVAILABLE", 1, 4.7, 12.972, 77.601),
            ("w.nair@civicxon.gov", dept_street, ["streetlight_maintenance"], ["North", "East"], "AVAILABLE", 1, 4.5, 13.014, 77.588),
            ("w.patel@civicxon.gov", dept_street, ["streetlight_maintenance"], ["West", "South"], "OFFLINE", 0, 4.1, 12.961, 77.509),
            ("w.reddy@civicxon.gov", dept_street, ["streetlight_maintenance"], ["Central", "East"], "AVAILABLE", 2, 4.4, 12.981, 77.655),
        ]
        now = datetime.utcnow()
        for email, dept, skills, zonelist, availability, load, rating, lat, lng in workers:
            profile = models.WorkerProfile(user_id=user_ids[email], department_id=dept.id, skills=skills, zones=zonelist,
                                           availability=availability, current_load=load, max_concurrent_jobs=3, rating=rating, jobs_completed=96)
            db.add(profile)
            db.flush()
            db.execute(text("UPDATE worker_profiles SET base_location = ST_GeogFromText(:pt) WHERE id = :i"),
                       {"pt": f"SRID=4326;POINT({lng} {lat})", "i": profile.id})

        suresh = db.query(models.WorkerProfile).filter(models.WorkerProfile.user_id == user_ids["worker@civicxon.gov"]).one()
        issue = models.Issue(ticket_no="CX-2026-0001", category=models.IssueCategory.pothole,
                             description="Deep pothole near the signal junction on 100 Feet Road. Two-wheelers keep swerving into the bus lane.",
                             status=models.IssueStatus.PENDING_VERIFICATION, priority=models.Priority.HIGH,
                             priority_reason="High-traffic corridor + two-wheeler hazard", reporter_id=user_ids["citizen@civicxon.gov"],
                             address="100 Feet Road, Indiranagar, Bengaluru", zone="Central", department_id=dept_road.id,
                             assigned_worker_id=suresh.id, ai_analysis={"provider": "gemma-4", "category": "pothole", "severity": "severe", "confidence": 0.88, "riskIndicators": ["Two-wheeler hazard", "High-traffic corridor"], "explanation": "Deep, water-filled pothole on lane edge; elevated two-wheeler risk on a busy corridor.", "departmentSuggestion": "Road Maintenance Department"},
                             created_at=now - timedelta(days=6), started_at=now - timedelta(days=4), assigned_at=now - timedelta(days=5))
        db.add(issue)
        db.flush()
        db.execute(text("UPDATE issues SET location = ST_GeogFromText(:pt) WHERE id = :i"), {"pt": "SRID=4326;POINT(77.6045 12.9758)", "i": issue.id})
        db.add(models.IssueEvent(issue_id=issue.id, actor_name="Rohan Mehta", actor_role="citizen", type="CREATED", message="Citizen reported the issue with photo evidence."))
        db.add(models.IssueEvent(issue_id=issue.id, actor_name="CivicXon System", actor_role="system", type="AI_ANALYSIS", message="AI analysis (gemma-4): pothole · severe · confidence 0.88"))
        db.add(models.IssueEvent(issue_id=issue.id, actor_name="CivicXon System", actor_role="system", type="ASSIGNED", message="Auto-assigned to Suresh Yadav."))
        db.add(models.IssueEvent(issue_id=issue.id, actor_name="Suresh Yadav", actor_role="worker", type="EVIDENCE_SUBMITTED", message="Worker submitted after-repair photo evidence."))
        db.add(models.Assignment(issue_id=issue.id, worker_id=suresh.id, score=91.5, breakdown={"skill": 100, "distance": 92, "workload": 66.7, "availability": 100, "distance_km": 0.9}, reason="skill 100 · 0.9 km · load 1/3 · available ⇒ 91.5", source="AUTO", status="ACTIVE", created_at=now - timedelta(days=5)))

        db.commit()
        print("Seeded: 2 departments · 5 zones ·", len(accounts), "users ·", len(workers), "workers · 1 issue (PENDING_VERIFICATION CX-2026-0001)")
        print("Demo login: admin@civicxon.gov / citizen@civicxon.gov / worker@civicxon.gov — password: Civicxon@2026")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
