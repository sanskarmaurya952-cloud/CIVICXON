from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from .. import models
from ..database import get_db
from ..security import hash_password, verify_password, issue_token, get_current_user, MAX_ATTEMPTS, LOCK_MINUTES
from ..config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class RegisterIn(BaseModel):
    name: str
    email: str
    phone: str
    password: str


class BootstrapAdminIn(BaseModel):
    name: str
    email: str
    phone: str
    password: str


def _validate_password(p: str):
    problems = []
    if len(p) < 8: problems.append("at least 8 characters")
    if not any(c.isupper() for c in p): problems.append("one uppercase letter")
    if not any(c.islower() for c in p): problems.append("one lowercase letter")
    if not any(c.isdigit() for c in p): problems.append("one digit")
    if problems:
        raise HTTPException(422, f"Weak password: {', '.join(problems)}")


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == body.email.strip().lower()).first()
    if not user:
        raise HTTPException(401, "No account found for that email")
    if not user.active:
        raise HTTPException(403, "Account deactivated. Contact an administrator.")
    if user.locked_until and datetime.utcnow() < user.locked_until:
        mins = int((user.locked_until - datetime.utcnow()).total_seconds() // 60) + 1
        raise HTTPException(429, f"Account locked. Try again in {mins} min.")
    if not verify_password(body.password, user.password_hash):
        user.failed_attempts += 1
        if user.failed_attempts >= MAX_ATTEMPTS:
            user.locked_until = datetime.utcnow() + __import__('datetime').timedelta(minutes=LOCK_MINUTES)
        db.commit()
        remaining = max(0, MAX_ATTEMPTS - user.failed_attempts)
        raise HTTPException(401, f"Incorrect password. {remaining} attempt(s) remaining." if remaining else "Account locked for 10 minutes.")
    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = datetime.utcnow()
    db.commit()
    return {"access_token": issue_token(user), "token_type": "bearer", "role": user.role.value, "name": user.name, "id": user.id}


@router.post("/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.email == body.email.strip().lower()).first():
        raise HTTPException(409, "Email already registered")
    _validate_password(body.password)
    user = models.User(name=body.name.strip(), email=body.email.strip().lower(), phone=body.phone.strip(),
                       role=models.Role.citizen, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"access_token": issue_token(user), "token_type": "bearer", "role": user.role.value, "name": user.name, "id": user.id}


@router.post("/bootstrap-admin", status_code=201)
def bootstrap_admin(body: BootstrapAdminIn, db: Session = Depends(get_db)):
    """One-time first admin. Disabled as soon as any admin exists."""
    if db.query(models.User).filter(models.User.role == models.Role.admin).first():
        raise HTTPException(409, "An administrator already exists. Ask them to create your account.")
    _validate_password(body.password)
    user = models.User(name=body.name.strip(), email=body.email.strip().lower(), phone=body.phone.strip(),
                       role=models.Role.admin, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"access_token": issue_token(user), "token_type": "bearer", "role": user.role.value, "name": user.name, "id": user.id}


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone, "role": user.role.value}
