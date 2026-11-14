"""Configuración por variables de entorno."""
import base64
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _db_url() -> str:
    url = os.environ.get("DATABASE_URL", "sqlite:///./diadas_local.db")
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    def __init__(self) -> None:
        self.production = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PRODUCTION"))
        self.database_url = _db_url()
        self.secret_key = os.environ.get("SECRET_KEY", "")
        self.data_key_b64 = os.environ.get("DATA_ENCRYPTION_KEY", "")
        self.admin_email = os.environ.get("ADMIN_EMAIL", "jaleonhardt@uc.cl").strip().lower()
        self.admin_password = os.environ.get("ADMIN_PASSWORD", "")
        self.notify_email = os.environ.get("NOTIFY_EMAIL", "jaleonhardt@uc.cl").strip()
        self.mapbox_token = os.environ.get("MAPBOX_TOKEN", "")
        self.resend_api_key = os.environ.get("RESEND_API_KEY", "")
        self.email_from = os.environ.get("EMAIL_FROM", "Encuesta de Díadas <onboarding@resend.dev>")
        self.smtp_host = os.environ.get("SMTP_HOST", "")
        self.smtp_port = int(os.environ.get("SMTP_PORT", "587"))
        self.smtp_user = os.environ.get("SMTP_USER", "")
        self.smtp_password = os.environ.get("SMTP_PASSWORD", "")
        self.app_url = os.environ.get("APP_URL", "").rstrip("/")
        self.target_n = int(os.environ.get("TARGET_N", "100"))
        self.static_dir = Path(os.environ.get("STATIC_DIR", ROOT / "frontend" / "dist"))
        self.instrument_path = Path(os.environ.get("INSTRUMENT_PATH", ROOT / "shared" / "instrument.json"))

        if self.production:
            missing = [k for k, v in {
                "SECRET_KEY": self.secret_key,
                "DATA_ENCRYPTION_KEY": self.data_key_b64,
                "ADMIN_PASSWORD": self.admin_password,
            }.items() if not v]
            if missing:
                raise RuntimeError("Faltan variables de entorno obligatorias: " + ", ".join(missing))
        else:
            # Valores de desarrollo: nunca se usan en producción (ver validación anterior).
            self.secret_key = self.secret_key or "dev-secret-no-usar-en-produccion"
            self.data_key_b64 = self.data_key_b64 or base64.b64encode(b"0" * 32).decode()
            self.admin_password = self.admin_password or "admin"

        try:
            self.data_key = base64.b64decode(self.data_key_b64)
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("DATA_ENCRYPTION_KEY debe estar en base64") from exc
        if len(self.data_key) != 32:
            raise RuntimeError("DATA_ENCRYPTION_KEY debe ser una clave de 32 bytes en base64")

    @property
    def email_configured(self) -> bool:
        return bool(self.resend_api_key or self.smtp_host)


settings = Settings()
