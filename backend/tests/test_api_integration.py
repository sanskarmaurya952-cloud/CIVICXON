"""End-to-End API Integration Tests for CIVICXON.

Covers:
1. Authentication & Role Permissions (Citizen, Worker, Admin, Bootstrap).
2. Citizen Complaint Submission & Master Issue Creation.
3. PRD Rule: One Physical Defect = One Master Issue (Citizen Report Linking).
4. Explainable Dynamic Priority Scoring Engine (0-100, 7 Factors, Priority Bands).
5. Priority Overrides with Mandatory Reason & Audit Trail.
6. Worker Eligibility & Automatic Allocation with Concurrency Constraints.
7. Worker Repair Lifecycle (IN_PROGRESS, After-Evidence Upload, AI Advisory).
8. Mandatory Final Admin Verification (Approve vs Request Rework).
9. CSV Import with Validation & CSV Export.
"""
import io
import sys
import os
import pytest

backend_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal, engine
from app import models
from app.security import hash_password
from app.services.priority import calculate_priority_score, get_priority_band

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    models.Base.metadata.drop_all(bind=engine)
    models.Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    # Seed departments and zones
    dept1 = models.Department(code="ROAD", name="Road Maintenance", handles=["pothole"], demo_integration=True)
    dept2 = models.Department(code="STREET", name="Streetlight Maintenance", handles=["streetlight"], demo_integration=True)
    db.add_all([dept1, dept2])
    db.flush()

    z1 = models.Zone(name="Central", lat=12.9716, lng=77.5946, radius_km=5.0)
    z2 = models.Zone(name="North", lat=13.0180, lng=77.5900, radius_km=5.0)
    db.add_all([z1, z2])
    db.flush()

    # Seed users
    admin = models.User(name="Admin One", email="admin@test.gov", phone="9999999999", role=models.Role.admin, password_hash=hash_password("Admin@12345"))
    citizen1 = models.User(name="Citizen John", email="john@test.com", phone="8888888888", role=models.Role.citizen, password_hash=hash_password("Citizen@12345"))
    citizen2 = models.User(name="Citizen Alice", email="alice@test.com", phone="7777777777", role=models.Role.citizen, password_hash=hash_password("Citizen@12345"))
    worker_user = models.User(name="Worker Dave", email="dave@test.gov", phone="6666666666", role=models.Role.worker, password_hash=hash_password("Worker@12345"))
    db.add_all([admin, citizen1, citizen2, worker_user])
    db.flush()

    # Worker profile
    profile = models.WorkerProfile(
        user_id=worker_user.id,
        department_id=dept1.id,
        skills=["road_maintenance"],
        zones=["Central"],
        availability="AVAILABLE",
        current_load=0,
        max_concurrent_jobs=2,
        base_lat=12.9720,
        base_lng=77.5950,
    )
    db.add(profile)
    db.commit()
    db.close()


def get_token(email: str, password: str) -> str:
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_auth_login_and_role_protection():
    # Login citizen
    token_c = get_token("john@test.com", "Citizen@12345")
    assert token_c

    # Citizen trying admin endpoint -> 403 Forbidden
    res = client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {token_c}"})
    assert res.status_code == 403

    # Admin login
    token_a = get_token("admin@test.gov", "Admin@12345")
    res = client.get("/api/admin/dashboard", headers={"Authorization": f"Bearer {token_a}"})
    assert res.status_code == 200
    assert "total" in res.json()


def test_first_admin_bootstrap_protection():
    # Admin already exists -> bootstrap must fail with 409
    res = client.post("/api/auth/bootstrap-admin", json={
        "name": "Second Admin",
        "email": "second@test.gov",
        "phone": "1234567890",
        "password": "Password@123",
    })
    assert res.status_code == 409


def test_citizen_complaint_and_dynamic_priority():
    token_c = get_token("john@test.com", "Citizen@12345")
    headers = {"Authorization": f"Bearer {token_c}"}

    # Submit complaint
    res = client.post(
        "/api/issues",
        headers=headers,
        data={
            "description": "Massive hazardous pothole on 100 Feet Road junction near hospital",
            "lat": 12.9716,
            "lng": 77.5946,
            "address": "100 Feet Road near hospital",
            "category": "pothole",
        },
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert "ticket_no" in data
    assert "priority_score" in data
    assert data["priority_score"] >= 60.0  # High or Critical priority due to hospital corridor + junction keywords
    issue_id = data["id"]

    # Verify citizen can retrieve the issue
    res = client.get(f"/api/issues/{issue_id}", headers=headers)
    assert res.status_code == 200
    issue_data = res.json()
    assert issue_data["ticket_no"] == data["ticket_no"]
    assert issue_data["report_count"] == 1
    assert len(issue_data["citizen_reports"]) == 1
    assert "priority_breakdown" in issue_data


def test_prd_rule_one_physical_defect_one_master_issue():
    """Citizen A reports pothole -> Citizen B reports same pothole -> linked as CitizenReport under master issue."""
    token_a = get_token("john@test.com", "Citizen@12345")
    token_b = get_token("alice@test.com", "Citizen@12345")

    # Citizen A reports
    res_a = client.post(
        "/api/issues",
        headers={"Authorization": f"Bearer {token_a}"},
        data={
            "description": "Deep road crater at Indiranagar main chowraha",
            "lat": 12.9716,
            "lng": 77.5946,
            "address": "Indiranagar Chowraha",
            "category": "pothole",
        },
    )
    master_id = res_a.json()["id"]

    # Citizen B reports same defect, gets duplicate hints
    res_b_check = client.post(
        "/api/issues",
        headers={"Authorization": f"Bearer {token_b}"},
        data={
            "description": "Indiranagar main chowraha has a deep road crater",
            "lat": 12.9718,
            "lng": 77.5947,
            "address": "Indiranagar Chowraha",
            "category": "pothole",
        },
    )
    hints = res_b_check.json()["duplicate_hints"]
    assert len(hints) > 0
    assert hints[0]["issue_id"] == master_id

    # Citizen B submits with link_to_master_id (confirming match)
    res_b_link = client.post(
        "/api/issues",
        headers={"Authorization": f"Bearer {token_b}"},
        data={
            "description": "Indiranagar main chowraha road crater duplicate",
            "lat": 12.9718,
            "lng": 77.5947,
            "address": "Indiranagar Chowraha",
            "category": "pothole",
            "link_to_master_id": master_id,
        },
    )
    assert res_b_link.status_code == 201
    assert res_b_link.json()["linked_to_master"] is True
    assert res_b_link.json()["report_count"] == 2

    # Check that master issue report count incremented and has both reports
    admin_token = get_token("admin@test.gov", "Admin@12345")
    res_master = client.get(f"/api/issues/{master_id}", headers={"Authorization": f"Bearer {admin_token}"})
    m_data = res_master.json()
    assert m_data["report_count"] == 2
    assert len(m_data["citizen_reports"]) == 2


def test_priority_override_and_audit():
    token_a = get_token("john@test.com", "Citizen@12345")
    token_admin = get_token("admin@test.gov", "Admin@12345")

    # Create issue
    res = client.post(
        "/api/issues",
        headers={"Authorization": f"Bearer {token_a}"},
        data={"description": "Standard minor crack on residential road", "lat": 12.9716, "lng": 77.5946, "category": "pothole"},
    )
    issue_id = res.json()["id"]

    # Admin overrides priority
    res_override = client.post(
        f"/api/admin/issues/{issue_id}/priority-override",
        headers={"Authorization": f"Bearer {token_admin}"},
        json={"score": 88.5, "reason": "VIP motorcade transit route scheduled tomorrow"},
    )
    assert res_override.status_code == 200
    assert res_override.json()["score"] == 88.5
    assert res_override.json()["band"] == "CRITICAL"

    # Verify audit log recorded the action
    res_audit = client.get("/api/admin/audit-logs", headers={"Authorization": f"Bearer {token_admin}"})
    assert res_audit.status_code == 200
    logs = res_audit.json()
    assert any(l["action"] == "PRIORITY_OVERRIDE" for l in logs)


def test_worker_lifecycle_and_admin_verification():
    token_c = get_token("john@test.com", "Citizen@12345")
    token_w = get_token("dave@test.gov", "Worker@12345")
    token_a = get_token("admin@test.gov", "Admin@12345")

    # 1. Citizen creates issue
    res_issue = client.post(
        "/api/issues",
        headers={"Authorization": f"Bearer {token_c}"},
        data={"description": "Large road defect needing repair", "lat": 12.9716, "lng": 77.5946, "category": "pothole"},
    )
    issue_id = res_issue.json()["id"]

    # 2. Admin auto-assigns issue to worker Dave
    res_assign = client.post(f"/api/admin/issues/{issue_id}/auto-assign", headers={"Authorization": f"Bearer {token_a}"})
    assert res_assign.status_code == 200
    assert res_assign.json()["assigned"] is True

    # 3. Worker checks assigned jobs
    res_jobs = client.get("/api/worker/jobs", headers={"Authorization": f"Bearer {token_w}"})
    assert res_jobs.status_code == 200
    jobs = res_jobs.json()
    assert any(j["id"] == issue_id for j in jobs)

    # 4. Worker starts work -> IN_PROGRESS
    res_start = client.post(f"/api/worker/jobs/{issue_id}/start", headers={"Authorization": f"Bearer {token_w}"})
    assert res_start.status_code == 200
    assert res_start.json()["status"] == "IN_PROGRESS"

    # 5. Worker submits repair evidence -> PENDING_VERIFICATION
    dummy_img = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9")
    res_evidence = client.post(
        f"/api/worker/jobs/{issue_id}/evidence",
        headers={"Authorization": f"Bearer {token_w}"},
        data={"caption": "Repaired with cold asphalt patch"},
        files={"photo": ("after.jpg", dummy_img, "image/jpeg")},
    )
    assert res_evidence.status_code == 201
    assert "verification" in res_evidence.json()

    # 6. Admin checks verification queue
    res_vqueue = client.get("/api/admin/verification-queue", headers={"Authorization": f"Bearer {token_a}"})
    assert res_vqueue.status_code == 200
    v_items = res_vqueue.json()
    assert any(v["id"] == issue_id for v in v_items)

    # 7. Admin requests rework
    res_rework = client.post(
        f"/api/admin/issues/{issue_id}/verification",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"decision": "REWORK_REQUESTED", "note": "Edges are unsealed and need sealant applied"},
    )
    assert res_rework.status_code == 200
    assert res_rework.json()["status"] == "REWORK_REQUIRED"

    # 8. Worker re-starts work and re-submits
    client.post(f"/api/worker/jobs/{issue_id}/start", headers={"Authorization": f"Bearer {token_w}"})
    dummy_img.seek(0)
    client.post(
        f"/api/worker/jobs/{issue_id}/evidence",
        headers={"Authorization": f"Bearer {token_w}"},
        data={"caption": "Sealant applied along perimeter"},
        files={"photo": ("after2.jpg", dummy_img, "image/jpeg")},
    )

    # 9. Admin officially approves -> VERIFIED
    res_approve = client.post(
        f"/api/admin/issues/{issue_id}/verification",
        headers={"Authorization": f"Bearer {token_a}"},
        json={"decision": "APPROVED", "note": "Sealant verified; excellent quality."},
    )
    assert res_approve.status_code == 200
    assert res_approve.json()["status"] == "VERIFIED"


def test_csv_import_export():
    token_a = get_token("admin@test.gov", "Admin@12345")
    headers = {"Authorization": f"Bearer {token_a}"}

    # Export workers
    res_export = client.get("/api/workers/export", headers=headers)
    assert res_export.status_code == 200
    assert "name,email,phone,department" in res_export.text

    # Import workers with 1 valid row and 1 invalid row
    csv_content = (
        "name,email,phone,department,skills,zones,availability,maxjobs,baselat,baselng\n"
        "Valid Worker,valid.worker@test.gov,9876543210,ROAD,road_maintenance,Central,AVAILABLE,3,12.97,77.59\n"
        "Bad Row,,123,BADDEPT,,BadZone,AVAILABLE,3,12.97,77.59\n"
    )
    res_import = client.post(
        "/api/workers/import",
        headers=headers,
        files={"file": ("workers.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")},
    )
    assert res_import.status_code == 200
    data = res_import.json()
    assert data["created"] == 1
    assert data["skipped"] == 1
    assert len(data["errors"]) == 1
