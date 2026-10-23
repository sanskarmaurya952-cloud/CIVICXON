import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .routers import auth, issues, admin, workers, worker

app = FastAPI(
    title="CIVICXON API",
    description="AI-assisted civic issue resolution platform — Road & Streetlight Maintenance Departments. Auth: OAuth2 password flow with JWT. All mutating endpoints enforce role + ownership server-side.",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.UPLOAD_DIR), name="media")

app.include_router(auth.router)
app.include_router(issues.router)
app.include_router(admin.router)
app.include_router(workers.router)
app.include_router(worker.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "civicxon-api", "storage": settings.STORAGE_BACKEND,
            "ai_provider": "gemma-4" if settings.GEMMA_API_KEY else "heuristic-dev"}
