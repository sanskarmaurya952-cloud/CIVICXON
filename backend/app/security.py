import bcrypt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from .config import settings
from .database import SessionLocal
from . import models

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

MAX_ATTEMPTS = 5
LOCK_MINUTES = 10


def hash_password(password: str) -> str:
    pwd_bytes = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        pwd_bytes = password.encode("utf-8")[:72]
        return bcrypt.checkpw(pwd_bytes, password_hash.encode("utf-8"))
    except Exception:
        return False


def issue_token(user: models.User) -> str:
    payload = {
        "sub": str(user.id),
        "role": user.role.value,
        "name": user.name,
        "exp": datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme)) -> models.User:
    exc = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise exc
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user or not user.active:
            raise exc
        db.expunge(user)
        return user
    finally:
        db.close()


def require_role(*roles: models.Role):
    def checker(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Requires role: {', '.join(r.value for r in roles)}")
        return user
    return checker


require_citizen = require_role(models.Role.citizen)
require_worker = require_role(models.Role.worker)
require_admin = require_role(models.Role.admin)


def require_worker_owns(issue: models.Issue, worker: models.WorkerProfile) -> None:
    if issue.assigned_worker_id != worker.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This job is not assigned to you")
