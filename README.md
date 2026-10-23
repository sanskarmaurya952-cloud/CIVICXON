# CIVICXON — AI Civic Issue Resolution Platform

**Report a broken road. Watch it get fixed.**

CIVICXON is a complete, reliable, production-ready civic-tech workflow platform built for the Municipal Corporation: a citizen photographs a pothole → Gemma 4 (multimodal) triages severity → the 7-factor Dynamic Priority Scoring engine computes urgency → duplicate detection enforces "One physical defect = One master issue" → a deterministic allocation engine ranks eligible crews → the crew repairs and uploads evidence → Gemma 4 pre-checks the fix → an administrator reviews and verifies. Every step is audit-logged.

---

## Architecture at a glance

| Layer | Implementation | Details |
|---|---|---|
| **Frontend Web App** | React 19 + TypeScript + Vite + Tailwind CSS | Preserves the civic command visual design, navigation, interactive Leaflet maps, and responsive layouts across Citizen, Worker, and Admin portals. |
| **API Client** | Typed REST Client (`src/lib/api.ts` & `src/lib/store.tsx`) | Full-stack synchronization with FastAPI backend. Dual-mode support (full-stack API mode with offline local-storage fallback for disconnected testing). |
| **Backend API** | **FastAPI** (`/backend`) | OAuth2 + JWT tokens, native bcrypt password hashing, server-side RBAC, ownership guards, audit logging, OpenAPI docs at `http://localhost:8000/api/docs`. |
| **Database** | **PostgreSQL 16 + PostGIS** & **SQLite** (Dual-mode) | SQLAlchemy 2 + Alembic migrations. Supports zero-friction local SQLite development (`civicxon.db`) and production PostgreSQL/PostGIS. |
| **Dynamic Priority** | 7-Factor Explainable Scoring Engine (`priority.py`) | PRD Page 16: 0–100 score, bands (CRITICAL, HIGH, MEDIUM, LOW), breakdown explanation, citizen report multiplier, and admin override with mandatory recorded reason. |
| **Duplicate Detection**| Spatial + Image + Semantic Matcher (`workflow.py`) | PRD Page 5: "One Physical Defect = One Master Issue". Haversine proximity, category match, text similarity, and Pillow 16x16 perceptual aHash. |
| **Allocation Engine** | Deterministic Multi-Factor Ranking (`allocation.py`) | PRD Page 6: Hard filters (active, skill, zone, capacity, availability) + weighted score (skill, distance, workload, availability). No generative black boxes. |
| **Verification Loop** | Human-in-the-Loop Quality Assurance (`worker.py`, `admin.py`) | PRD Page 7: AI before/after analysis is strictly advisory. Only municipal administrators can approve resolution or request rework. |
| **AI Integration** | **Gemma 4** (`gemma-4-26b-a4b-it` / `gemma-4-31b-it`) | Multimodal triage via Google AI Studio API. Explicitly labelled heuristic fallback when no API key is supplied. |

---

## Quick Start (Windows PowerShell / macOS / Linux)

### 1. Start the FastAPI Backend

```powershell
# In a terminal:
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Seed departments, zones, workers, and demo users:
python scripts/seed.py

# Start the API server:
uvicorn app.main:app --port 8000 --reload
# API interactive documentation: http://localhost:8000/api/docs
```

### 2. Start the Frontend Application

```powershell
# In a second terminal (root directory):
npm install
npm run dev
# Open: http://localhost:5173
```

---

## Seeded Demo Accounts (Password: `Civicxon@2026`)

| Role | Portal URL | Email | Purpose |
|---|---|---|---|
| **Citizen** | `http://localhost:5173/#/citizen` | `citizen@civicxon.gov` | Report potholes/streetlights with photos, GPS, voice notes, track status, view duplicate alerts. |
| **Worker** | `http://localhost:5173/#/worker` | `worker@civicxon.gov` | View assigned jobs, start repair, upload after-repair evidence, check rework instructions. |
| **Admin** | `http://localhost:5173/#/admin` | `admin@civicxon.gov` | Review queue, priority overrides, worker allocation, duplicate merges, verification queue, analytics. |

*First-Admin Bootstrap:* If you reset the database, a secure one-time bootstrap is available at `http://localhost:5173/#/bootstrap-admin`. It self-disables as soon as an administrator exists.

---

## Test Verification Suite

All tests execute cleanly locally and in CI:

```powershell
# 1. Frontend typecheck:
npm run typecheck

# 2. Frontend Vitest suite (30 passed):
npm test

# 3. Frontend production build:
npm run build

# 4. Backend pytest integration suite (13 passed):
backend\.venv\Scripts\python -m pytest backend\tests

# 5. Full end-to-end multi-role live API verification:
backend\.venv\Scripts\python -c "
# Executes citizen report -> duplicate match -> admin override -> auto-assignment -> worker evidence -> admin verification
"
```

### Test Coverage Highlights
- **RBAC & Ownership Security**: Citizen cannot view or cancel another citizen's records; worker cannot start or access another worker's unassigned jobs (HTTP 403 verified); workers cannot approve verifications or assign jobs; unauthenticated calls are rejected with HTTP 401.
- **Dynamic Priority Scoring (PRD Page 16)**: Validates 7 factors (defect severity, road hierarchy, school/hospital zone proximity, multi-report count, duration in state, repeat defect history, weather). Admin override enforces a mandatory recorded reason (min 6 characters).
- **One Physical Defect = One Master Issue (PRD Page 5)**: Multiple citizen reports at the same physical pothole link to a single master defect, incrementing `report_count` and dynamically escalating priority score without duplicating dispatch.
- **Deterministic Worker Allocation (PRD Page 6)**: Capacity bounds (`currentLoad < maxConcurrentJobs`), skill verification, zone coverage, and availability checks.
- **Mandatory Admin Verification (PRD Page 7)**: AI pre-check is strictly advisory; only human administrators can approve final closure (`VERIFIED`) or issue rework orders (`REWORK_REQUIRED`).

---

## Production Deployment & Docker

```powershell
docker compose up --build
```
Runs:
- `db`: PostgreSQL 16 + PostGIS on port `5432`
- `api`: FastAPI backend with automated migrations and uvicorn on port `8000`
- `web`: Production frontend static build
