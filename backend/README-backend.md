# CIVICXON — Production Backend (FastAPI + PostgreSQL/PostGIS / SQLite)

The CIVICXON backend is a production-grade FastAPI service providing authoritative civic workflow management, deterministic worker dispatch, dynamic priority scoring, spatial/perceptual duplicate detection, and audit logging.

---

## Key Capabilities (PRD Conformance)

1. **Deterministic 7-Factor Dynamic Priority Engine** (`app/services/priority.py`):
   - Computes 0–100 score and priority bands: `CRITICAL` (80–100), `HIGH` (60–79), `MEDIUM` (40–59), and `LOW` (0–39).
   - Weighted factors: Defect Severity (25%), Road Classification / Hierarchy (20%), High-Risk Location / School-Hospital Proximity (20%), Public Multi-Report Escalation (15%), Age / Duration in Open State (10%), Repeat Recurrence History (5%), and Weather Exposure (5%).
   - Explainable factor-by-factor breakdown returned on every ticket.
   - Admin override with mandatory recorded reason (PRD Page 16).

2. **Duplicate Detection: "One Physical Defect = One Master Issue"** (`app/services/workflow.py`):
   - Combines Haversine spatial proximity (within 350m for streetlights, 100m for potholes), category matching, text similarity, and Pillow 16x16 perceptual aHash.
   - Classifies matches into `SAME_ISSUE`, `POSSIBLE_DUPLICATE`, and `DISTINCT_ISSUE`.
   - Linked citizen reports increment the master defect's `report_count` and escalate priority without dispatching duplicate crews.

3. **Deterministic Worker Allocation Engine** (`app/services/allocation.py`):
   - Hard eligibility gates: account active, exact skill (`road_maintenance` vs `streetlight_maintenance`), zone boundary coverage, availability (`AVAILABLE` / `BUSY`), and concurrency limit (`current_load < max_concurrent_jobs`).
   - Auditable score ranking: Skill Match (45%) + Proximity (25%) + Current Workload (20%) + Availability (10%).

4. **Human-in-the-Loop Verification Queue** (`app/routers/admin.py`, `worker.py`):
   - Field crews submit after-repair photo evidence.
   - Gemma 4 / heuristic engine provides advisory pre-check (`likely_resolved`, `not_resolved`, `uncertain`).
   - Mandatory admin sign-off: Admin makes the binding decision (`APPROVED` → `VERIFIED`, or `REWORK_REQUESTED` → `REWORK_REQUIRED` with specific instructions).

5. **Security & Server-Side RBAC**:
   - Native `bcrypt` password hashing (`$2b$`) with 72-byte safe handling.
   - Scoped queries: Citizens cannot view or modify other citizens' records; workers cannot start or view jobs not assigned to them (HTTP 403 verified).
   - Rate limiting and failed-attempt tracking.
   - Secure one-time first-admin bootstrap.

---

## Running the Backend

### Windows PowerShell
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Seed departments, zones, workers, and demo users:
python scripts/seed.py

# Run FastAPI server:
uvicorn app.main:app --port 8000 --reload
# Interactive API documentation: http://localhost:8000/api/docs
```

### Automated Tests
```powershell
backend\.venv\Scripts\python -m pytest backend\tests
```
13 end-to-end integration tests covering:
- Authentication & RBAC enforcement
- Citizen complaint creation & 7-factor priority calculation
- Duplicate detection & citizen report linking
- Worker job lifecycle & ownership guards
- Admin priority override & mandatory audit logging
- Verification review lifecycle & rework requests

---

## Seed Accounts (Development Only)
- Admin: `admin@civicxon.gov` / `Civicxon@2026`
- Citizen: `citizen@civicxon.gov` / `Civicxon@2026`
- Worker: `worker@civicxon.gov` / `Civicxon@2026`
