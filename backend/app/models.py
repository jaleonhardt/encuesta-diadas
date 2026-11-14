from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

Json = JSON().with_variant(JSONB(), "postgresql")


def now() -> datetime:
    return datetime.now(timezone.utc)


class Interviewer(Base):
    __tablename__ = "interviewers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    code_hash: Mapped[str] = mapped_column(String(300))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Survey(Base):
    """Una fila por díada. `responses` contiene todo salvo lo sensible."""
    __tablename__ = "surveys"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    codigo: Mapped[str] = mapped_column(String(32), index=True)
    interviewer_email: Mapped[str] = mapped_column(String(200), index=True)
    interviewer_name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(32), index=True)
    rev: Mapped[int] = mapped_column(Integer, default=0)
    is_test: Mapped[bool] = mapped_column(Boolean, default=False)
    excluded: Mapped[bool] = mapped_column(Boolean, default=False)
    comuna: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    responses: Mapped[dict] = mapped_column(Json, default=dict)
    email_start_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    email_final_sent: Mapped[bool] = mapped_column(Boolean, default=False)


class SurveySensitive(Base):
    """Domicilio, nombre, geometrías y firmas, cifrados y separados del resto de la base."""
    __tablename__ = "survey_sensitive"
    survey_id: Mapped[str] = mapped_column(String(64), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True)
    payload: Mapped[bytes] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Event(Base):
    """Paradatos: bitácora cronológica de todo lo que ocurre durante la aplicación."""
    __tablename__ = "events"
    survey_id: Mapped[str] = mapped_column(String(64), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    t: Mapped[str] = mapped_column(String(40))
    type: Mapped[str] = mapped_column(String(40), index=True)
    item: Mapped[str | None] = mapped_column(String(60), nullable=True)
    data: Mapped[dict | None] = mapped_column(Json, nullable=True)


class AudioChunk(Base):
    __tablename__ = "audio_chunks"
    survey_id: Mapped[str] = mapped_column(String(64), ForeignKey("surveys.id", ondelete="CASCADE"), primary_key=True)
    segment: Mapped[int] = mapped_column(Integer, primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    mime: Mapped[str] = mapped_column(String(80))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Tombstone(Base):
    """Encuestas eliminadas: impide que un tablet las vuelva a subir."""
    __tablename__ = "tombstones"
    survey_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    codigo: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    deleted_by: Mapped[str] = mapped_column(String(200))


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(Json)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    t: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    actor: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[dict | None] = mapped_column(Json, nullable=True)


class EmailLog(Base):
    __tablename__ = "email_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    t: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    kind: Mapped[str] = mapped_column(String(40))
    survey_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
