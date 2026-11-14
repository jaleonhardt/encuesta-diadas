"""Correos de validación (inicio y cierre de cada encuesta). Nunca incluyen datos sensibles."""
import html
import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage
from zoneinfo import ZoneInfo

import httpx

from .config import settings
from .db import SessionLocal
from .models import AudioChunk, EmailLog, Event, Survey

log = logging.getLogger("diadas.email")
TZ = ZoneInfo("America/Santiago")

STATUS_LABEL = {
    "en_curso": "En curso",
    "completada": "Completada",
    "terminada_filtro": "Terminada en el filtro (no cumple criterios)",
    "interrumpida": "Interrumpida",
}


def fmt_dt(dt: datetime | None) -> str:
    if not dt:
        return "sin registro"
    return dt.astimezone(TZ).strftime("%d-%m-%Y %H:%M:%S") + " (hora de Chile)"


def _send(subject: str, html_body: str, text_body: str) -> None:
    if settings.resend_api_key:
        r = httpx.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.email_from, "to": [settings.notify_email], "subject": subject,
                  "html": html_body, "text": text_body},
            timeout=20,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Resend respondió {r.status_code}: {r.text[:300]}")
        return
    if settings.smtp_host:
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, settings.email_from, settings.notify_email
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return
    raise RuntimeError("Correo no configurado: falta RESEND_API_KEY o SMTP_HOST")


def _rows_html(rows: list[tuple[str, str]]) -> str:
    return "".join(
        f'<tr><td style="padding:6px 16px 6px 0;color:#5b6b66;vertical-align:top">{html.escape(k)}</td>'
        f'<td style="padding:6px 0;color:#14201d"><b>{html.escape(str(v))}</b></td></tr>' for k, v in rows)


def _build(kind: str, s: Survey, extra: dict) -> tuple[str, str, str]:
    r = s.responses or {}
    a = r.get("answers", {})
    test = " [PRUEBA]" if s.is_test else ""
    if kind == "start":
        subject = f"Encuesta de Díadas{test}: inicio registrado {s.codigo}"
        lead = "Se inició una encuesta y su registro ya está en la base de datos."
    else:
        subject = f"Encuesta de Díadas{test}: {STATUS_LABEL.get(s.status, s.status).lower()} {s.codigo}"
        lead = "La encuesta fue enviada y quedó registrada en la base de datos."
    rows = [
        ("Código de la díada", s.codigo),
        ("Identificador", s.id),
        ("Estado", STATUS_LABEL.get(s.status, s.status)),
        ("Encuestador", f"{s.interviewer_name} ({s.interviewer_email})"),
        ("Inicio en el tablet", fmt_dt(s.started_at)),
        ("Recibido en el servidor", fmt_dt(s.created_at)),
    ]
    if kind != "start":
        dur = ""
        if s.started_at and s.completed_at:
            dur = f"{(s.completed_at - s.started_at).total_seconds() / 60:.1f} minutos"
        dests = a.get("destinos") or []
        rows += [
            ("Término en el tablet", fmt_dt(s.completed_at)),
            ("Duración total", dur or "sin registro"),
            ("Comuna", s.comuna or "sin registro"),
            ("Polígono B1 (sin acompañamiento)", a.get("B1_estado", "sin registro")),
            ("Polígono B2 (acompañado)", a.get("B2_estado", "sin registro")),
            ("Destinos registrados", len(dests)),
            ("Módulo P", {1: "aplicado", 0: "no aplicado"}.get((a.get("P") or {}).get("aplicado"), "sin registro")),
            ("Eventos de trazabilidad recibidos", extra.get("events", 0)),
            ("Fragmentos de audio recibidos", extra.get("audio", 0)),
            ("Revisión guardada", s.rev),
            ("Completadas válidas en la base", f'{extra.get("n_valid", 0)} de {settings.target_n}'),
        ]
    link = f'<p style="margin:20px 0 0"><a href="{settings.app_url}/admin" style="color:#0e7c6b">Abrir el portal de administración</a></p>' if settings.app_url else ""
    body_html = (
        '<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#14201d;max-width:560px">'
        f'<p style="margin:0 0 14px">{html.escape(lead)}</p>'
        f'<table style="border-collapse:collapse">{_rows_html(rows)}</table>{link}'
        '<p style="margin:20px 0 0;color:#5b6b66;font-size:13px">Este correo no incluye nombres, direcciones ni ubicaciones.</p></div>'
    )
    body_text = lead + "\n\n" + "\n".join(f"{k}: {v}" for k, v in rows)
    return subject, body_html, body_text


def notify(kind: str, survey_id: str) -> None:
    """Se ejecuta en segundo plano. Marca el envío solo si fue exitoso, para reintentar en el siguiente guardado."""
    db = SessionLocal()
    try:
        s = db.get(Survey, survey_id)
        if not s:
            return
        flag = "email_start_sent" if kind == "start" else "email_final_sent"
        if getattr(s, flag):
            return
        extra = {
            "events": db.query(Event).filter(Event.survey_id == s.id).count(),
            "audio": db.query(AudioChunk).filter(AudioChunk.survey_id == s.id).count(),
            "n_valid": db.query(Survey).filter(Survey.status == "completada", Survey.is_test.is_(False),
                                               Survey.excluded.is_(False)).count(),
        }
        subject, h, t = _build(kind, s, extra)
        try:
            _send(subject, h, t)
            setattr(s, flag, True)
            db.add(EmailLog(kind=kind, survey_id=s.id, ok=True))
        except Exception as exc:  # noqa: BLE001
            log.warning("No se pudo enviar el correo (%s, %s): %s", kind, s.codigo, exc)
            db.add(EmailLog(kind=kind, survey_id=s.id, ok=False, error=str(exc)[:500]))
        db.commit()
    finally:
        db.close()


def send_test() -> None:
    _send("Encuesta de Díadas: correo de prueba",
          "<p>El envío de correos está funcionando.</p>", "El envío de correos está funcionando.")
