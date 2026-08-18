"""Auth + user management for the RFP Master Tracking app.

- Custom JWT auth (bcrypt password hash, httpOnly cookies).
- Roles: viewer / editor / admin.
- Admin-invite-only user creation (no public signup).
"""
from __future__ import annotations

import os
import uuid
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field, ConfigDict

JWT_ALGORITHM = "HS256"
ACCESS_TTL_MIN = 60 * 12   # 12 hours (internal ops tool)
REFRESH_TTL_DAYS = 7

ROLES = ("viewer", "editor", "admin")


def _jwt_secret() -> str:
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured")
    return secret


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role, "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TTL_MIN),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id, "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def _set_auth_cookies(response: Response, access: str, refresh: str) -> None:
    response.set_cookie(
        key="access_token", value=access, httponly=True, secure=True,
        samesite="none", max_age=ACCESS_TTL_MIN * 60, path="/",
    )
    response.set_cookie(
        key="refresh_token", value=refresh, httponly=True, secure=True,
        samesite="none", max_age=REFRESH_TTL_DAYS * 24 * 3600, path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")


# ---------------------------- Pydantic Schemas ---------------------------- #

class User(BaseModel):
    id: str
    email: EmailStr
    name: Optional[str] = None
    role: str = "viewer"
    created_at: Optional[str] = None
    must_change_password: bool = False


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class CreateUserBody(BaseModel):
    email: EmailStr
    name: Optional[str] = ""
    role: str = "viewer"
    password: str = Field(min_length=8)


class UpdateUserBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: Optional[str] = None
    role: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=8)


# ---------------------------- Auth Dependencies ---------------------------- #

async def _load_current_user(request: Request, db) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid session")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


def require_user_dep(db):
    async def _dep(request: Request):
        return await _load_current_user(request, db)
    return _dep


def require_role_dep(db, allowed: tuple):
    async def _dep(request: Request):
        user = await _load_current_user(request, db)
        if user.get("role") not in allowed:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _dep


# ---------------------------- Router Factory ---------------------------- #

def _to_public_user(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "email": doc["email"],
        "name": doc.get("name") or "",
        "role": doc.get("role") or "viewer",
        "created_at": doc.get("created_at"),
        "must_change_password": bool(doc.get("must_change_password", False)),
    }


def build_auth_router(db, require_user, require_admin) -> APIRouter:
    router = APIRouter()

    # ----------------- /auth ----------------- #

    @router.post("/auth/login")
    async def login(body: LoginBody, response: Response, request: Request):
        email = body.email.lower().strip()
        # Extract real client IP from X-Forwarded-For (first entry) since we're
        # behind an ingress that rotates upstream IPs; falls back to the socket.
        xff = request.headers.get("x-forwarded-for", "")
        client_ip = (xff.split(",")[0].strip() if xff else "") \
            or (request.client.host if request.client else "unknown")
        ident = f"{client_ip}:{email}"
        now = datetime.now(timezone.utc)
        # Brute force check
        attempts = await db.login_attempts.find_one({"identifier": ident})
        if attempts and attempts.get("count", 0) >= 5:
            locked_until = attempts.get("locked_until")
            # motor returns naive datetimes; normalize to UTC-aware before compare.
            if isinstance(locked_until, datetime):
                if locked_until.tzinfo is None:
                    locked_until = locked_until.replace(tzinfo=timezone.utc)
                if now < locked_until:
                    raise HTTPException(status_code=429, detail="Too many failed attempts. Try again in 15 minutes.")
        user = await db.users.find_one({"email": email})
        if not user or not verify_password(body.password, user.get("password_hash", "")):
            new_count = (attempts.get("count", 0) if attempts else 0) + 1
            update = {"count": new_count, "identifier": ident, "last_attempt": now}
            if new_count >= 5:
                update["locked_until"] = now + timedelta(minutes=15)
            await db.login_attempts.update_one({"identifier": ident}, {"$set": update}, upsert=True)
            raise HTTPException(status_code=401, detail="Invalid email or password")
        # Success — clear brute force counter.
        await db.login_attempts.delete_one({"identifier": ident})
        access = create_access_token(user["id"], user["email"], user.get("role") or "viewer")
        refresh = create_refresh_token(user["id"])
        _set_auth_cookies(response, access, refresh)
        return _to_public_user(user)

    @router.post("/auth/logout")
    async def logout(response: Response, _user: dict = Depends(require_user)):
        _clear_auth_cookies(response)
        return {"ok": True}

    @router.get("/auth/me")
    async def me(user: dict = Depends(require_user)):
        return _to_public_user(user)

    @router.post("/auth/refresh")
    async def refresh_token(request: Request, response: Response):
        token = request.cookies.get("refresh_token")
        if not token:
            raise HTTPException(status_code=401, detail="Missing refresh token")
        try:
            payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
        except jwt.PyJWTError:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Bad token type")
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(status_code=401, detail="User missing")
        access = create_access_token(user["id"], user["email"], user.get("role") or "viewer")
        new_refresh = create_refresh_token(user["id"])
        _set_auth_cookies(response, access, new_refresh)
        return _to_public_user(user)

    @router.post("/auth/change-password")
    async def change_password(
        body: ChangePasswordBody, user: dict = Depends(require_user),
    ):
        doc = await db.users.find_one({"id": user["id"]})
        if not doc or not verify_password(body.current_password, doc["password_hash"]):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {
                "password_hash": hash_password(body.new_password),
                "must_change_password": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        return {"ok": True}

    # ----------------- /users (admin only) ----------------- #

    @router.get("/users", response_model=List[User])
    async def list_users(_admin: dict = Depends(require_admin)):
        docs = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("email", 1).to_list(500)
        return [_to_public_user(d) for d in docs]

    @router.post("/users", response_model=User, status_code=201)
    async def create_user(body: CreateUserBody, _admin: dict = Depends(require_admin)):
        email = body.email.lower().strip()
        if body.role not in ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of: {', '.join(ROLES)}")
        if await db.users.find_one({"email": email}):
            raise HTTPException(status_code=409, detail="A user with that email already exists")
        doc = {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": (body.name or "").strip(),
            "role": body.role,
            "password_hash": hash_password(body.password),
            "must_change_password": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(doc)
        return _to_public_user(doc)

    @router.put("/users/{user_id}", response_model=User)
    async def update_user(
        user_id: str, body: UpdateUserBody, admin: dict = Depends(require_admin),
    ):
        doc = await db.users.find_one({"id": user_id})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        updates: dict = {}
        if body.name is not None:
            updates["name"] = body.name.strip()
        if body.role is not None:
            if body.role not in ROLES:
                raise HTTPException(status_code=400, detail="Invalid role")
            # Prevent removing the last admin.
            if doc.get("role") == "admin" and body.role != "admin":
                admin_count = await db.users.count_documents({"role": "admin"})
                if admin_count <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last admin")
            updates["role"] = body.role
        if body.password:
            updates["password_hash"] = hash_password(body.password)
            updates["must_change_password"] = True
        if not updates:
            return _to_public_user(doc)
        updates["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.users.update_one({"id": user_id}, {"$set": updates})
        updated = await db.users.find_one({"id": user_id})
        return _to_public_user(updated)

    @router.delete("/users/{user_id}")
    async def delete_user(user_id: str, admin: dict = Depends(require_admin)):
        doc = await db.users.find_one({"id": user_id})
        if not doc:
            raise HTTPException(status_code=404, detail="User not found")
        if doc["id"] == admin["id"]:
            raise HTTPException(status_code=400, detail="You cannot delete your own account")
        if doc.get("role") == "admin":
            admin_count = await db.users.count_documents({"role": "admin"})
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the last admin")
        await db.users.delete_one({"id": user_id})
        return {"ok": True}

    return router


# ---------------------------- Startup ---------------------------- #

async def bootstrap_indexes_and_admin(db) -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    # Auto-purge lockout records 24h after last_attempt so login_attempts doesn't grow forever.
    await db.login_attempts.create_index("identifier")
    await db.login_attempts.create_index("last_attempt", expireAfterSeconds=86400)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)

    admin_email = (os.environ.get("ADMIN_EMAIL") or "admin@evolvebpm.com").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD") or "EvolveBPM@2026"
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "Administrator",
            "role": "admin",
            "password_hash": hash_password(admin_password),
            "must_change_password": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    elif not verify_password(admin_password, existing.get("password_hash", "")):
        # Keep the seed admin's password aligned with .env for recoverability.
        await db.users.update_one(
            {"email": admin_email},
            {"$set": {
                "password_hash": hash_password(admin_password),
                "role": "admin",
                "must_change_password": True,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
