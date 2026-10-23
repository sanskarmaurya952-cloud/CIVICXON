# CIVICXON — AI Civic Issue Resolution Platform

**Report a broken road. Watch it get fixed.**

CIVICXON is a complete civic-tech workflow platform: a citizen photographs a pothole → Gemma 4 (multimodal) triages severity → a deterministic allocation engine ranks eligible crews → the crew repairs and uploads evidence → Gemma 4 pre-checks the fix → an administrator decides. Every step is audit-logged.

---

## Architecture at a glance

| Layer | Production (this repo) | Demo runtime (this app) |
|---|---|---|
| Web app | Vite + React 19 + TypeScript · Tailwind v4 · Leaflet/OSM · Recharts | Same — served statically |
| API | **FastAPI** in `/backend` — OAuth2 + JWT, role guards, audit log, OpenAPI at `/api/docs` | In-browser engine (`src/lib/store.tsx`) with identical rules, seeded + persisted to `localStorage` |
| Database | **PostgreSQL 16 + PostGIS** via SQLAlchemy 2 + Alembic migrations | Versioned document store (localStorage) + PostGIS query semantics implemented in TS |
| File storage | Local `./uploads` → swappable S3/MinIO (`STORAGE_BACKEND=s3`) | Data-URL object store behind the same `FileStorage` interface |
| AI | **Gemma 4** — `gemma-4-26b-a4b-it` / `gemma-4-31b-it` (multimodal: text + image) via Google AI Studio | Same provider contract; falls back to an explicitly-labelled dev heuristic when no key is set |
| Tests | pytest (backend) · vitest (frontend) — **36 tests, all executed locally** | — |

The two runtimes share one design contract: the same entities, the same state machine (`REPORTED → UNDER_REVIEW → ASSIGNED → IN_PROGRESS → PENDING_VERIFICATION → VERIFIED` + `REJECTED`/`DUPLICATE`/`REWORK_REQUIRED`/`CANCELLED`), the same allocation weights, the same AI provider interface. The frontend currently runs on the in-browser engine (zero infrastructure, works offline, deploys as static files); the FastAPI backend is the production path, ready when you are.

---

## Quick start (5 minutes, Windows PowerShell)

```powershell
# 1. Clone / enter the project
cd civicxon

# 2. Install & run the web app
npm install
npm run dev
# → http://localhost:5173
```

Demo accounts (seeded, password `Civicxon@2026`):

| Portal | URL | Account |
|---|---|---|
| Landing + portals | `http://localhost:5173` | — |
| Citizen | `#/citizen` | `citizen@civicxon.gov` |
| Worker | `#/worker` | `worker@civicxon.gov` |
| Admin | `#/admin` | `admin@civicxon.gov` |

On first load the database seeds itself (users, 8 crews across 2 departments, 5 zones, issues spanning the full workflow — including one ticket already in **PENDING_VERIFICATION** so the verification loop demos instantly).

**First-admin bootstrap:** if you wipe demo data, the first admin is created via `http://localhost:5173/#/bootstrap-admin` — the endpoint is one-time and self-disables afterwards.

### macOS / Linux
```bash
npm install && npm run dev
```

### Full-stack mode (FastAPI + PostgreSQL/PostGIS)
```powershell
docker compose up --build          # db + api (auto-migrated + seeded)
# API docs: http://localhost:8000/api/docs
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000
```
See [`backend/README-backend.md`](backend/README-backend.md).

---

## Test suite — actually executed

```powershell
npm test                  # vitest — 30 frontend tests
cd backend; python -m pytest tests/ -q   # 6 backend tests
```

**Latest run (this workspace, 2026-10-22):**

```
 Test Files  2 passed (2)
      Tests  30 passed (30)     ← workflow machine, allocation rules, duplicates, aHash, crypto, e2e engine

backend: 6 passed               ← state machine, scoring bounds, haversine, text similarity
```

Covered: authentication policy, role guards, state-machine legality (including rework loop and un-merge), allocation eligibility (skill/zone/capacity/availability/deactivation), deterministic ranking, duplicate detection (proximity + category + text + image aHash), password policy, seed integrity, and the complete citizen→admin→worker→verification loop at the engine level. Known limit: browser-level UI automation (Playwright) is not wired in this sandbox; the engine-level e2e proves the same transitions the UI drives.

---

## The workflow, end to end

```
CITIZEN files photo report
      │  AI triage (Gemma 4): category · severity · risks · department · confidence
      │  Duplicate scan: 350 m radius + category + description + image aHash
      ▼
REPORTED ──▶ UNDER_REVIEW ──approve──▶ allocation engine
                                          │  filter: skill ∧ zone ∧ availability ∧ capacity ∧ active
                                          │  rank:   skill 45 + distance 25 + workload 20 + availability 10 (configurable)
                                          ▼
                                       ASSIGNED ──▶ worker starts ──▶ IN_PROGRESS
                                                                       │  after-photo evidence
                                                                       ▼
                                              PENDING_VERIFICATION ──▶ AI pre-check (likely_resolved / not_resolved / uncertain)
                                                                       │  admin decides — always
                                            ┌────────── approved ───────┴─────────── rework ──────────┐
                                            ▼                                                          ▼
                                       VERIFIED                                        REWORK_REQUIRED ▶ IN_PROGRESS (resubmit)
```

**AI can never close a ticket.** Every AI output — triage or verification — is advisory; the audit trail records both the model's recommendation and the administrator's decision, side by side.

---

## Gemma 4 — credentials & contract

1. Open [aistudio.google.com](https://aistudio.google.com/apikey) and create a free API key (`AIza…`).
2. In the app: **Admin Console → Settings & AI** → choose **Gemma 4 — live**, paste the key, optionally switch to `gemma-4-31b-it`, then press **Test Gemma 4 connection**.
3. In production: set `GEMMA_API_KEY` in the backend environment instead of the browser.

| Fact | Value (verified 2026-10-22) |
|---|---|
| Model ids | `gemma-4-26b-a4b-it` (26B MoE, ~4B active — default), `gemma-4-31b-it` (31B dense) |
| Input | text + **image** (multimodal) |
| Output | text (we request `responseMimeType: application/json` and validate + clamp every field) |
| Auth | `x-goog-api-key` header · generativelanguage.googleapis.com/v1beta |
| Free tier | Available via Google AI Studio |
| Fallback | Missing key/timeout/parse failure → explicitly-labelled dev heuristic — **never** silently presented as AI |

## Smart allocation — deterministic, not generative

Eligibility is a hard rules gate: active account, exact skill, zone coverage, `AVAILABLE|BUSY`, `currentLoad < maxConcurrentJobs`. Survivors are ranked with configurable weights (skill 45 / distance 25 / workload 20 / availability 10 by default — sliders in Admin → Settings). The result — ranking, score, breakdown, reason, assignment history — is persisted on every decision. Concurrency is handled by re-validating eligibility inside the assignment transaction; the backend additionally takes `SELECT … FOR UPDATE` on candidate rows.

**Adding a worker requires zero model training** — a new row with skills, zones and capacity is immediately rankable. The UI surfaces this by showing the full ranked table next to the winner.

---

## Portals

### Citizen — `/#/citizen`
Overview (total/open/in-progress/resolved/verification counters, live map, activity feed), report form (auto GPS + map-pin override, photo upload with compression, optional voice note, auto/manual issue type), AI-triaged receipt with duplicate warnings, full report detail (progress timeline, AI analysis, audit trail, notes, cancel-before-work).

### Worker — `/#/worker`
Identity bar (department, skills, rating), queue of assigned jobs (priority-sorted, rework-first), job detail (before photo, map link, navigation, start work, after-evidence upload with compression, AI pre-check readout), rework inbox, field notes. Ownership is enforced, not just hidden buttons.

### Admin — `/#/admin`
Command bar + 7 KPIs, live city map, critical queue, workforce load bars, operations feed. Review queue with AI analysis + reason-required priority + auto-assign + merge duplicates + full ranked allocation table. Verification console with before/after comparison. Complaints browser with full-text search, filters, CSV export, and per-ticket assignment history. Worker management (create/edit/deactivate, skills/zones/capacity, **validated CSV import**, export). Analytics (14-day inflow vs closures, categories, priorities, statuses, workforce throughput). Activity & audit trail. Settings (allocation weights, auto-assign toggle, AI provider, Gemma key + live connection test).

---

## Project layout

```
├── src/
│   ├── lib/            # types, config(storage), crypto(PBKDF2), geo(haversine),
│   │                   # scoring(allocation), workflow(state machine + duplicates),
│   │                   # ai(Gemma 4 provider), seed, store(React engine)
│   ├── pages/citizen/ worker/ admin/
│   └── components/     # Shell, LeafletMap, Modal, Toast, UI kit
├── tests/              # vitest suites
├── backend/            # FastAPI + SQLAlchemy + Alembic + PostGIS production service
├── docker-compose.yml
└── .env.example · index.html · public/
```

## Environment & secrets
- `.env.example` — copy to `.env`. Frontend exposes only `VITE_*` (non-secret). Backend `.env` holds `GEMMA_API_KEY` — never committed (`.gitignore`), never logged.
- First deploy: `npm ci && npm run build && npm run preview`, or Docker Compose above.

## Known limitations (honest list)
1. The browser runtime persists to `localStorage` (≈5 MB); seed media is pre-compressed JPEG. Production media belongs in S3/MinIO via the included abstraction.
2. Browser-vs-backend: the frontend currently ships against the in-browser engine; pointing it at FastAPI requires the thin HTTP client swap sketched in `.env.example` (`VITE_API_BASE_URL`) — both runtimes are deliberately identical in behavior.
3. Image similarity uses aHash (robust to resizing, weaker on crops). The backend's PostGIS `ST_DWithin` path needs PostgreSQL for production-scale duplicate scans; the engine scans in memory (fine at civic-demo scale).
4. `BUSY` workers remain eligible at 35 % availability score by design; `OFFLINE`/`ON_LEAVE` are hard-filtered.
5. Demo passwords are published for review purposes only — rotate or reseed before real use.
6. Gemma 4 free tier is rate-limited; the UI degrades to the labelled dev baseline automatically on errors, with the failure reason visible in the admin Settings test panel.
