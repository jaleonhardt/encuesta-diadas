"""API de la Encuesta de Díadas."""
import logging
import statistics
from collections import Counter
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from . import emailer
from .config import settings
from .crypto import decrypt_bytes, decrypt_json, encrypt_bytes, encrypt_json
from .db import Base, engine, get_db
from .export import INSTRUMENT, ITEMS, block_of, build_zip, clean, options
from .geo import polygon_area
from .models import (AudioChunk, AuditLog, EmailLog, Event, Interviewer, Setting, Survey,
                     SurveySensitive, Tombstone, now)
from .security import (User, admin_user, check_login_rate, current_user, hash_code, make_token,
                       new_access_code, verify_admin_password, verify_code)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("diadas")

TERMINAL = {"completada", "terminada_filtro", "interrumpida"}
STATUSES = TERMINAL | {"en_curso"}

DEFAULT_SETTINGS = {
    "fase": "piloto",
    "incluir_reserva": True,
    "tareas": {"B3": True, "C8": True, "C9": True, "C10": True},
    "consentimiento_aprobado": False,
    "consentimiento_cuidador": (
        "BORRADOR. Reemplace este texto por el consentimiento informado aprobado por el Comité Ético Científico.\n\n"
        "Usted ha sido invitado o invitada a participar en el estudio «Del umbral universal a la proximidad relacional», "
        "tesis doctoral de Janus Leonhardt en la Pontificia Universidad Católica de Chile, con el patrocinio del Centro UC Síndrome de Down.\n\n"
        "La participación consiste en una entrevista de 35 a 40 minutos sobre los desplazamientos a pie de la persona a quien usted apoya, "
        "que incluye dibujar sobre un mapa. Luego, si ella lo acepta, la persona responde un módulo breve con tarjetas.\n\n"
        "Su participación es voluntaria. Puede no responder cualquier pregunta y retirarse en cualquier momento, sin dar explicaciones.\n\n"
        "El domicilio y lo que se dibuje en el mapa se tratan como datos sensibles: se guardan cifrados, separados del resto de las respuestas, "
        "y solo se publican medidas que no permiten identificar a nadie."
    ),
    "consentimiento_persona": [
        {"picto": 7217, "texto": "Quiero hacerte unas preguntas sobre cómo te mueves por tu barrio."},
        {"picto": 6517, "texto": "No hay respuestas buenas ni malas. Me interesa lo que tú piensas."},
        {"picto": 37185, "texto": "Puedes parar cuando quieras. No pasa nada si paras."},
        {"picto": 2912, "texto": "Voy a grabar lo que conversamos, para no olvidar lo que dices."},
        {"picto": 5584, "texto": "¿Quieres participar?"},
    ],
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    yield


app = FastAPI(title="Encuesta de Díadas", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(GZipMiddleware, minimum_size=2000)


def get_settings(db: Session) -> dict:
    row = db.get(Setting, "study")
    merged = {**DEFAULT_SETTINGS, **(row.value if row else {})}
    merged["tareas"] = {**DEFAULT_SETTINGS["tareas"], **(merged.get("tareas") or {})}
    return merged


def audit(db: Session, user: User, action: str, detail: dict | None = None) -> None:
    db.add(AuditLog(actor=user.email, action=action, detail=detail))


def parse_dt(v) -> datetime | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------- sesión

class LoginIn(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    check_login_rate(request.client.host if request.client else "?")
    email = body.email.strip().lower()
    if email == settings.admin_email and verify_admin_password(body.password):
        return {"token": make_token(email, "Janus Leonhardt", "admin"), "role": "admin", "email": email, "name": "Janus Leonhardt"}
    iv = db.query(Interviewer).filter(Interviewer.email == email).first()
    if iv and iv.active and verify_code(body.password.strip().upper(), iv.code_hash):
        return {"token": make_token(iv.email, iv.name, "interviewer"), "role": "interviewer", "email": iv.email, "name": iv.name}
    raise HTTPException(401, "Correo o clave incorrectos")


@app.get("/api/config")
def client_config(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return {"mapbox_token": settings.mapbox_token, "settings": get_settings(db), "target_n": settings.target_n,
            "server_time": now().isoformat(), "user": {"email": user.email, "name": user.name, "role": user.role}}


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("select 1"))
    return {"ok": True, "time": now().isoformat()}


# ---------------------------------------------------------------- sincronización desde el tablet

class SurveyIn(BaseModel):
    rev: int
    status: str
    state: dict


def _own(s: Survey, user: User) -> None:
    if not user.is_admin and s.interviewer_email != user.email:
        raise HTTPException(403, "Esta encuesta pertenece a otro encuestador")


@app.put("/api/surveys/{sid}")
def put_survey(sid: str, body: SurveyIn, bg: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.status not in STATUSES:
        raise HTTPException(422, "Estado desconocido")
    if db.get(Tombstone, sid):
        raise HTTPException(410, "Esta encuesta fue eliminada por el administrador")
    state = dict(body.state)
    if state.get("id") != sid:
        raise HTTPException(422, "El identificador no coincide")
    geo = state.pop("geo", None) or {}
    answers = state.get("answers") or {}
    meta = state.get("meta") or {}
    s = db.get(Survey, sid)
    created = s is None
    if created:
        iv = state.get("interviewer") or {}
        s = Survey(id=sid, codigo=str(state.get("codigo") or sid[:8]), rev=-1,
                   interviewer_email=user.email if not user.is_admin else (iv.get("email") or user.email),
                   interviewer_name=user.name if not user.is_admin else (iv.get("name") or user.name),
                   status=body.status)
        db.add(s)
    else:
        _own(s, user)
        if body.rev < s.rev:
            # Llegó una versión más antigua que la guardada (reintento tardío): se ignora sin error.
            return {"ok": True, "rev": s.rev, "stale": True, "status": s.status}
    was_terminal = (not created) and s.status in TERMINAL
    s.rev = body.rev
    s.status = body.status
    s.is_test = bool(state.get("is_test")) or (s.is_test if not created else False)
    s.comuna = (answers.get("comuna") or None)
    s.started_at = parse_dt(meta.get("started_at")) or s.started_at
    s.completed_at = parse_dt(meta.get("completed_at"))
    s.responses = state
    sens = db.get(SurveySensitive, sid)
    blob = encrypt_json(geo)
    if sens:
        sens.payload = blob
    else:
        db.flush()
        db.add(SurveySensitive(survey_id=sid, payload=blob))
    db.commit()
    if not s.email_start_sent:
        bg.add_task(emailer.notify, "start", sid)
    if s.status in TERMINAL and not s.email_final_sent:
        bg.add_task(emailer.notify, "final", sid)
    return {"ok": True, "rev": s.rev, "created": created, "status": s.status, "was_terminal": was_terminal,
            "received_at": now().isoformat()}


class EventsIn(BaseModel):
    events: list[dict]


@app.post("/api/surveys/{sid}/events")
def post_events(sid: str, body: EventsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(Tombstone, sid):
        raise HTTPException(410, "Encuesta eliminada")
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(409, "La encuesta todavía no existe en el servidor")
    _own(s, user)
    seqs = [int(e["seq"]) for e in body.events]
    have = set()
    if seqs:
        have = {r[0] for r in db.query(Event.seq).filter(Event.survey_id == sid, Event.seq >= min(seqs), Event.seq <= max(seqs))}
    added = 0
    for e in body.events:
        seq = int(e["seq"])
        if seq in have:
            continue
        have.add(seq)
        db.add(Event(survey_id=sid, seq=seq, t=str(e.get("t", "")), type=str(e.get("type", ""))[:40],
                     item=(str(e["item"])[:60] if e.get("item") else None), data=e.get("data")))
        added += 1
    db.commit()
    return {"ok": True, "added": added, "max_seq": max(seqs) if seqs else None}


@app.put("/api/surveys/{sid}/audio/{segment}/{seq}")
async def put_audio(sid: str, segment: int, seq: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.get(Tombstone, sid):
        raise HTTPException(410, "Encuesta eliminada")
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(409, "La encuesta todavía no existe en el servidor")
    _own(s, user)
    data = await request.body()
    if not data:
        raise HTTPException(422, "Fragmento vacío")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(413, "Fragmento demasiado grande")
    if not db.get(AudioChunk, (sid, segment, seq)):
        db.add(AudioChunk(survey_id=sid, segment=segment, seq=seq, size=len(data),
                          mime=request.headers.get("content-type", "audio/webm")[:80], data=encrypt_bytes(data)))
        db.commit()
    return {"ok": True, "size": len(data)}


@app.get("/api/surveys/{sid}/receipt")
def receipt(sid: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Comprobante que el tablet consulta para confirmar que todo llegó."""
    if db.get(Tombstone, sid):
        raise HTTPException(410, "Encuesta eliminada")
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(404, "No existe")
    _own(s, user)
    audio = db.query(AudioChunk.segment, func.count()).filter(AudioChunk.survey_id == sid).group_by(AudioChunk.segment).all()
    return {"rev": s.rev, "status": s.status, "events": db.query(Event).filter(Event.survey_id == sid).count(),
            "max_seq": db.query(func.max(Event.seq)).filter(Event.survey_id == sid).scalar(),
            "audio": {str(seg): n for seg, n in audio}}


# ---------------------------------------------------------------- portal de administración

def _load(db: Session, include_tests=False, include_excluded=False, only_completed=False):
    q = db.query(Survey, SurveySensitive).outerjoin(SurveySensitive, SurveySensitive.survey_id == Survey.id)
    if not include_tests:
        q = q.filter(Survey.is_test.is_(False))
    if not include_excluded:
        q = q.filter(Survey.excluded.is_(False))
    if only_completed:
        q = q.filter(Survey.status == "completada")
    out = []
    for s, sens in q.order_by(Survey.created_at):
        geo = {}
        if sens:
            try:
                geo = decrypt_json(sens.payload)
            except Exception:  # noqa: BLE001
                log.error("No se pudo descifrar la encuesta %s: revise DATA_ENCRYPTION_KEY", s.id)
                geo = {"_error": "no se pudo descifrar"}
        out.append((s, s.responses or {}, geo))
    return out


def _list_item(s: Survey) -> dict:
    r = s.responses or {}
    a = r.get("answers", {}) or {}
    return {"id": s.id, "codigo": s.codigo, "status": s.status, "is_test": s.is_test, "excluded": s.excluded,
            "interviewer": s.interviewer_name, "interviewer_email": s.interviewer_email, "comuna": s.comuna,
            "started_at": s.started_at, "completed_at": s.completed_at, "updated_at": s.updated_at, "rev": s.rev,
            "duracion_min": round((s.completed_at - s.started_at).total_seconds() / 60, 1) if s.started_at and s.completed_at else None,
            "G1": a.get("G1"), "G2": a.get("G2"), "A3": a.get("A3"), "B1_estado": a.get("B1_estado"),
            "n_destinos": len(a.get("destinos") or []), "P_aplicado": (a.get("P") or {}).get("aplicado"),
            "email_start": s.email_start_sent, "email_final": s.email_final_sent}


@app.get("/api/admin/surveys")
def admin_list(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(Survey).order_by(Survey.created_at.desc()).all()
    return {"surveys": [_list_item(s) for s in rows]}


@app.get("/api/admin/surveys/{sid}")
def admin_detail(sid: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(404, "No existe")
    sens = db.get(SurveySensitive, sid)
    geo = decrypt_json(sens.payload) if sens else {}
    audio = db.query(AudioChunk.segment, func.count(), func.sum(AudioChunk.size), func.min(AudioChunk.mime)) \
        .filter(AudioChunk.survey_id == sid).group_by(AudioChunk.segment).order_by(AudioChunk.segment).all()
    audit(db, user, "ver_detalle", {"id": sid})
    db.commit()
    return {**_list_item(s), "responses": s.responses, "geo": geo,
            "events": db.query(Event).filter(Event.survey_id == sid).count(),
            "audio": [{"segment": seg, "chunks": n, "bytes": int(size or 0), "mime": mime} for seg, n, size, mime in audio]}


class FlagsIn(BaseModel):
    is_test: bool | None = None
    excluded: bool | None = None


@app.patch("/api/admin/surveys/{sid}")
def admin_flags(sid: str, body: FlagsIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(404, "No existe")
    if body.is_test is not None:
        s.is_test = body.is_test
    if body.excluded is not None:
        s.excluded = body.excluded
    audit(db, user, "marcar", {"id": sid, "codigo": s.codigo, **body.model_dump(exclude_none=True)})
    db.commit()
    return _list_item(s)


@app.delete("/api/admin/surveys/{sid}")
def admin_delete(sid: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    s = db.get(Survey, sid)
    if not s:
        raise HTTPException(404, "No existe")
    codigo = s.codigo
    for model in (Event, AudioChunk, SurveySensitive):
        db.query(model).filter(model.survey_id == sid).delete()
    db.delete(s)
    db.add(Tombstone(survey_id=sid, codigo=codigo, deleted_by=user.email))
    audit(db, user, "eliminar", {"id": sid, "codigo": codigo})
    db.commit()
    return {"ok": True}


@app.get("/api/admin/surveys/{sid}/events")
def admin_events(sid: str, _: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(Event).filter(Event.survey_id == sid).order_by(Event.seq).all()
    return {"events": [{"seq": e.seq, "t": e.t, "type": e.type, "item": e.item, "data": e.data} for e in rows]}


@app.get("/api/admin/surveys/{sid}/audio/{segment}")
def admin_audio(sid: str, segment: int, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    first = db.query(AudioChunk.mime).filter(AudioChunk.survey_id == sid, AudioChunk.segment == segment).first()
    if not first:
        raise HTTPException(404, "Sin audio")
    seqs = [r[0] for r in db.query(AudioChunk.seq).filter(AudioChunk.survey_id == sid, AudioChunk.segment == segment).order_by(AudioChunk.seq)]
    audit(db, user, "descargar_audio", {"id": sid, "segment": segment})
    db.commit()

    def gen():
        for seq in seqs:
            c = db.get(AudioChunk, (sid, segment, seq))
            if c:
                yield decrypt_bytes(c.data)
                db.expunge(c)

    mime = first[0].split(";")[0]
    ext = "m4a" if "mp4" in mime else ("ogg" if "ogg" in mime else "webm")
    s = db.get(Survey, sid)
    return StreamingResponse(gen(), media_type=mime, headers={
        "Content-Disposition": f'attachment; filename="{s.codigo if s else sid}_audio_{segment}.{ext}"'})


@app.get("/api/admin/export")
def admin_export(include_tests: bool = False, include_excluded: bool = False, only_completed: bool = True,
                 user: User = Depends(admin_user), db: Session = Depends(get_db)):
    records = _load(db, include_tests, include_excluded, only_completed)
    ids = [s.id for s, _, _ in records]
    events: dict[str, list] = {}
    if ids:
        for e in db.query(Event).filter(Event.survey_id.in_(ids)).order_by(Event.survey_id, Event.seq):
            events.setdefault(e.survey_id, []).append({"seq": e.seq, "t": e.t, "type": e.type, "item": e.item, "data": e.data})
    audit(db, user, "exportar", {"n": len(records), "include_tests": include_tests, "include_excluded": include_excluded})
    db.commit()
    data = build_zip(records, events)
    name = f"encuesta_diadas_{datetime.now(timezone.utc):%Y%m%d_%H%M}.zip"
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


def _dist(titulo: str, did: str, values: list, labels: dict | None = None, order: list | None = None) -> dict:
    c = Counter(v for v in values if v is not None and v != "")
    keys = order if order is not None else sorted(c, key=lambda k: (-c[k], str(k)))
    cats = [{"code": k, "label": (labels or {}).get(k, str(k)), "n": c.get(k, 0)} for k in keys]
    return {"id": did, "titulo": titulo, "n": sum(c.values()), "sin_dato": len(values) - sum(c.values()), "categorias": cats}


def _item_dist(key: str, rows: list[dict], titulo: str | None = None) -> dict:
    it = ITEMS[key]
    opts = options(it)
    return _dist(titulo or it["label"], key, [r.get(key) for r in rows],
                 {o["code"]: clean(o["label"]) for o in opts}, [o["code"] for o in opts])


def _age_group(v, cuts):
    if not isinstance(v, (int, float)):
        return None
    for lo, hi, lab in cuts:
        if lo <= v <= hi:
            return lab
    return None


@app.get("/api/admin/summary")
def admin_summary(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    all_rows = db.query(Survey).all()
    valid = [s for s in all_rows if s.status == "completada" and not s.is_test and not s.excluded]
    ans = [(s.responses or {}).get("answers", {}) or {} for s in valid]
    counts = {
        "objetivo": settings.target_n, "validas": len(valid),
        "en_curso": sum(1 for s in all_rows if s.status == "en_curso" and not s.is_test and not s.excluded),
        "interrumpidas": sum(1 for s in all_rows if s.status == "interrumpida" and not s.is_test and not s.excluded),
        "filtro": sum(1 for s in all_rows if s.status == "terminada_filtro" and not s.is_test and not s.excluded),
        "pruebas": sum(1 for s in all_rows if s.is_test), "excluidas": sum(1 for s in all_rows if s.excluded and not s.is_test),
        "total": len(all_rows),
    }
    comunas = Counter((s.comuna or "Sin comuna") for s in valid)
    comunas_curso = Counter((s.comuna or "Sin comuna") for s in all_rows if s.status == "en_curso" and not s.is_test and not s.excluded)
    por_comuna = [{"comuna": k, "validas": comunas.get(k, 0), "en_curso": comunas_curso.get(k, 0)}
                  for k in sorted(set(comunas) | set(comunas_curso), key=lambda k: (-comunas.get(k, 0), k))]

    psd_cuts = [(18, 24, "18 a 24"), (25, 34, "25 a 34"), (35, 44, "35 a 44"), (45, 120, "45 o más")]
    cui_cuts = [(18, 39, "Menos de 40"), (40, 54, "40 a 54"), (55, 69, "55 a 69"), (70, 120, "70 o más")]
    persona = [
        _dist("Edad", "G1", [_age_group(a.get("G1"), psd_cuts) for a in ans], order=[c[2] for c in psd_cuts]),
        _item_dist("G2", ans, "Género"), _item_dist("G3", ans), _item_dist("G4", ans), _item_dist("G5", ans),
    ]
    cuidador = [
        _item_dist("A3", ans, "Relación con la persona"),
        _dist("Edad", "H1", [_age_group(a.get("H1"), cui_cuts) for a in ans], order=[c[2] for c in cui_cuts]),
        _item_dist("H2", ans, "Género"), _item_dist("H3", ans), _item_dist("H4", ans),
        _item_dist("H9", ans), _item_dist("H8", ans), _item_dist("H10", ans),
    ]
    dests = [d for a in ans for d in (a.get("destinos") or [])]
    movilidad = [
        _dist("Polígono sin acompañamiento (B1)", "B1_estado", [a.get("B1_estado") for a in ans],
              {"dibujado": "Dibujado", "vacio": "No camina sin compañía", "omitido": "Omitido"}, ["dibujado", "vacio", "omitido"]),
        _item_dist("C5", dests, "Régimen de acompañamiento, por destino"),
        _dist("Destinos por díada", "n_dest", [len(a.get("destinos") or []) for a in ans], order=[0, 1, 2, 3, 4, 5]),
        _dist("Módulo P", "P", [(a.get("P") or {}).get("aplicado") for a in ans], {1: "Aplicado", 0: "No aplicado"}, [1, 0]),
        _dist("Lugar de aplicación", "lugar", [((s.responses or {}).get("meta") or {}).get("lugar") for s in valid],
              {"domicilio": "Domicilio", "centro_uc": "Centro UC", "otro": "Otro"}, ["domicilio", "centro_uc", "otro"]),
    ]

    # Duraciones (criterio del piloto: los bloques del cuidador no deben superar 40 minutos)
    block_ids = [b["id"] for b in INSTRUMENT["blocks"]]
    per_block: dict[str, list[float]] = {b: [] for b in block_ids}
    cuidador_min = []
    for s in valid:
        timings = (s.responses or {}).get("timings") or {}
        sums = Counter()
        for k, t in timings.items():
            sums[block_of(k)] += t.get("ms", 0)
        for b in block_ids:
            if sums.get(b):
                per_block[b].append(sums[b] / 60000)
        tot = sum(sums.get(b, 0) for b in block_ids if b != "P") / 60000
        if tot:
            cuidador_min.append(tot)
    med = lambda xs: round(statistics.median(xs), 1) if xs else None  # noqa: E731
    duraciones = {
        "cuidador_mediana": med(cuidador_min), "cuidador_max": round(max(cuidador_min), 1) if cuidador_min else None,
        "cuidador_sobre_40": sum(1 for x in cuidador_min if x > 40),
        "bloques": [{"id": b["id"], "titulo": b["titulo"], "previsto": b["minutos"], "mediana": med(per_block[b["id"]])}
                    for b in INSTRUMENT["blocks"]],
    }

    # Criterio del piloto: ningún indicador de E o F con más del 60% en una categoría
    indicadores = []
    for k, it in ITEMS.items():
        if not it.get("latent"):
            continue
        vals = [a.get(k) for a in ans if isinstance(a.get(k), int)]
        c = Counter(vals)
        top = max(c.values()) / len(vals) if vals else None
        indicadores.append({"item": k, "texto": clean(it["text"]).replace("[NOMBRE]", "la persona"), "latente": it["latent"],
                            "sentido": it["sense"], "reserva": bool(it.get("reserve")), "n": len(vals),
                            "dist": [c.get(x, 0) for x in (1, 2, 3, 4, 5)], "no_sabe": c.get(-88, 0),
                            "max_share": round(top, 3) if top is not None else None,
                            "alerta": bool(top is not None and top > 0.6 and len(vals) >= 5)})

    b1_areas = []
    for s, _, geo in _load(db, only_completed=True):
        g = (geo.get("B1") or {}).get("geometry")
        if g:
            b1_areas.append(polygon_area(g) / 10000)
    encuestadores = Counter(s.interviewer_name for s in valid)
    por_dia = Counter(s.completed_at.date().isoformat() for s in valid if s.completed_at)
    last_mail = db.query(EmailLog).order_by(EmailLog.id.desc()).first()
    return {
        "counts": counts, "por_comuna": por_comuna, "persona": persona, "cuidador": cuidador, "movilidad": movilidad,
        "duraciones": duraciones, "indicadores": indicadores,
        "b1": {"n": len(b1_areas), "mediana_ha": med(b1_areas)},
        "encuestadores": [{"nombre": k, "n": v} for k, v in encuestadores.most_common()],
        "por_dia": [{"fecha": k, "n": por_dia[k]} for k in sorted(por_dia)],
        "sistema": {"correo_configurado": settings.email_configured, "mapbox_configurado": bool(settings.mapbox_token),
                    "ultimo_correo": {"ok": last_mail.ok, "t": last_mail.t, "error": last_mail.error} if last_mail else None,
                    "correos_fallidos": db.query(EmailLog).filter(EmailLog.ok.is_(False)).count()},
    }


class InterviewerIn(BaseModel):
    name: str
    email: str


@app.get("/api/admin/interviewers")
def iv_list(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    n = dict(db.query(Survey.interviewer_email, func.count()).group_by(Survey.interviewer_email).all())
    return {"interviewers": [{"id": i.id, "name": i.name, "email": i.email, "active": i.active, "created_at": i.created_at,
                              "n_encuestas": n.get(i.email, 0)} for i in db.query(Interviewer).order_by(Interviewer.name)]}


@app.post("/api/admin/interviewers")
def iv_create(body: InterviewerIn, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not body.name.strip() or "@" not in email:
        raise HTTPException(422, "Ingrese nombre y correo")
    if email == settings.admin_email or db.query(Interviewer).filter(Interviewer.email == email).first():
        raise HTTPException(409, "Ya existe un usuario con ese correo")
    code = new_access_code()
    iv = Interviewer(name=body.name.strip(), email=email, code_hash=hash_code(code))
    db.add(iv)
    audit(db, user, "crear_encuestador", {"email": email})
    db.commit()
    return {"id": iv.id, "name": iv.name, "email": iv.email, "code": code}


class InterviewerPatch(BaseModel):
    active: bool | None = None
    reset_code: bool = False


@app.patch("/api/admin/interviewers/{iid}")
def iv_patch(iid: int, body: InterviewerPatch, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    iv = db.get(Interviewer, iid)
    if not iv:
        raise HTTPException(404, "No existe")
    out = {"id": iv.id}
    if body.active is not None:
        iv.active = body.active
    if body.reset_code:
        code = new_access_code()
        iv.code_hash = hash_code(code)
        out["code"] = code
    audit(db, user, "modificar_encuestador", {"email": iv.email, "active": body.active, "reset": body.reset_code})
    db.commit()
    return {**out, "active": iv.active}


@app.get("/api/admin/settings")
def settings_get(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    return get_settings(db)


@app.put("/api/admin/settings")
def settings_put(body: dict, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    allowed = {k: body[k] for k in DEFAULT_SETTINGS if k in body}
    row = db.get(Setting, "study")
    if row:
        row.value = {**row.value, **allowed}
    else:
        db.add(Setting(key="study", value=allowed))
    audit(db, user, "configuracion", {"claves": list(allowed)})
    db.commit()
    return get_settings(db)


@app.post("/api/admin/test-email")
def test_email(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    try:
        emailer.send_test()
        db.add(EmailLog(kind="test", ok=True))
        db.commit()
        return {"ok": True, "to": settings.notify_email}
    except Exception as exc:  # noqa: BLE001
        db.add(EmailLog(kind="test", ok=False, error=str(exc)[:500]))
        db.commit()
        raise HTTPException(502, f"No se pudo enviar: {exc}")


@app.get("/api/admin/audit")
def audit_list(_: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(200).all()
    return {"audit": [{"t": r.t, "actor": r.actor, "action": r.action, "detail": r.detail} for r in rows]}


# ---------------------------------------------------------------- aplicación web (archivos estáticos)

@app.exception_handler(404)
async def spa_fallback(request: Request, exc):
    path = request.url.path
    if path.startswith("/api/"):
        return JSONResponse({"detail": getattr(exc, "detail", "No encontrado")}, status_code=404)
    static = settings.static_dir
    candidate = (static / path.lstrip("/")).resolve()
    if candidate.is_file() and str(candidate).startswith(str(static.resolve())):
        headers = {}
        if candidate.name in ("sw.js", "index.html", "manifest.webmanifest", "registerSW.js"):
            headers["Cache-Control"] = "no-cache"
        elif "/assets/" in path or "/pictos/" in path:
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return FileResponse(candidate, headers=headers)
    index = static / "index.html"
    if index.is_file() and "." not in path.rsplit("/", 1)[-1]:
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "No encontrado"}, status_code=404)
