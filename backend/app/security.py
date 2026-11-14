import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import Interviewer

TOKEN_DAYS = 45  # largo, para que el encuestador pueda trabajar varios días sin conexión
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def hash_code(code: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", code.encode(), salt, 200_000)
    return f"pbkdf2${salt.hex()}${dk.hex()}"


def verify_code(code: str, stored: str) -> bool:
    try:
        _, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", code.encode(), bytes.fromhex(salt), 200_000)
        return hmac.compare_digest(calc.hex(), dk)
    except Exception:  # noqa: BLE001
        return False


def new_access_code() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(8))


def make_token(email: str, name: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS)
    return jwt.encode({"sub": email, "name": name, "role": role, "exp": exp}, settings.secret_key, algorithm="HS256")


class User:
    def __init__(self, email: str, name: str, role: str):
        self.email, self.name, self.role = email, name, role

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.lower().startswith("bearer ") else request.query_params.get("token", "")
    if not token:
        raise HTTPException(401, "No autenticado")
    try:
        p = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesión inválida o expirada")
    user = User(p["sub"], p.get("name", ""), p.get("role", "interviewer"))
    if not user.is_admin:
        iv = db.query(Interviewer).filter(Interviewer.email == user.email).first()
        if not iv or not iv.active:
            raise HTTPException(401, "Encuestador desactivado")
    return user


def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Solo el superadministrador puede hacer esto")
    return user


# Límite simple de intentos de inicio de sesión por IP
_attempts: dict[str, list[float]] = {}


def check_login_rate(ip: str) -> None:
    t = time.time()
    recent = [x for x in _attempts.get(ip, []) if t - x < 300]
    if len(recent) >= 10:
        raise HTTPException(429, "Demasiados intentos. Espere unos minutos.")
    recent.append(t)
    _attempts[ip] = recent


def verify_admin_password(password: str) -> bool:
    return hmac.compare_digest(password.encode(), settings.admin_password.encode())
