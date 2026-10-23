# CIVICXON — Production Backend (FastAPI + PostgreSQL/PostGIS)

This directory contains the production-grade backend that the browser build mirrors 1:1.
Entities, field names, state machine, allocation weights and AI provider contract are identical
to the in-browser engine so the frontend can be pointed at either.

## Quick start (Docker Compose)
```powershell
docker compose up --build          # db (postgis) + api (migrations + seed + uvicorn)
# API docs: http://localhost:8000/api/docs
```

## Manual setup (Windows PowerShell)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env        # edit DATABASE_URL / GEMMA_API_KEY
docker compose up -d db            # or your own PostGIS instance
alembic upgrade head               # runs migrations + CREATE EXTENSION postgis
python -m scripts.seed             # departments, zones, demo users/workers/issues
uvicorn app.main:app --reload --port 8000
```

## Commands (bash/macOS)
```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head && python -m scripts.seed
uvicorn app.main:app --reload --port 8000
```

## API surface (OpenAPI: /api/docs)
| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/bootstrap-admin` · `GET /api/auth/me` — JWT, bcrypt, lockout after 5 failures |
| Citizen | `GET/POST /api/issues` (photo multipart) · `GET /api/issues/{id}` · `GET /api/issues/{id}/events` · `POST /api/issues/{id}/cancel` |
| Worker | `GET /api/worker/jobs` · `POST /api/worker/jobs/{id}/start` · `POST /api/worker/jobs/{id}/evidence` (multipart, triggers AI verification) — ownership enforced |
| Admin | `GET /api/admin/dashboard` · `POST /api/admin/issues/{id}/approve-review` (sets priority + auto-assigns) · `/reject` · `/auto-assign` · `/assign/{worker_id}` · `/merge/{target}` · `POST /api/admin/issues/{id}/verification` (APPROVED / REWORK_REQUESTED) · `GET /api/admin/analytics` |
| Workers | `GET/POST /api/workers` · `PATCH /api/workers/{id}` · `POST /api/workers/{id}/active/{bool}` · `POST /api/workers/import` · `GET /api/workers/export` |

## Security model
- Passwords: bcrypt via passlib. JWTs: python-jose, HS256, `JWT_SECRET` env.
- Every mutating route declares its required role; worker routes additionally verify
  `issue.assigned_worker_id == profile.id` (ownership), admin routes verify `role == admin`.
- Status transitions validated by the shared state machine table (`models.VALID_TRANSITIONS`).
- Uploads: content-type allowlist + 6 MB cap + extension cross-check; bytes live in
  local `./uploads` (dev) or S3/MinIO (prod) — DB stores only object keys.
- `bootstrap-admin` is one-time and self-disables once an admin exists.
- Transactions: assignment + status change + event append + load bump are one DB transaction;
  worker rows are selected FOR UPDATE during ranking to prevent capacity races.

## Gemma 4
Set `GEMMA_API_KEY` in `.env` (Google AI Studio → aistudio.google.com/apikey).
Models: `gemma-4-26b-a4b-it` (default) / `gemma-4-31b-it`. Image input supported via inlineData.
When unset, services return explicitly-labelled development stubs — never fake model output.

## Demo accounts (after seed)
`admin@civicxon.gov` · `citizen@civicxon.gov` · `worker@civicxon.gov` — password `Civicxon@2026` (development only).
