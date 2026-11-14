import io
import json
import os
import tempfile
import zipfile

os.environ.setdefault("DATABASE_URL", "sqlite:///" + os.path.join(tempfile.mkdtemp(), "t.db"))
os.environ["ADMIN_PASSWORD"] = "clave-admin"

from fastapi.testclient import TestClient  # noqa: E402

from app import emailer  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import SurveySensitive  # noqa: E402

sent = []
emailer._send = lambda subject, h, t: sent.append((subject, t))  # type: ignore


def poly(d=0.004):
    return {"type": "Polygon", "coordinates": [[[-70.6, -33.45], [-70.6 + d, -33.45], [-70.6 + d, -33.45 + d], [-70.6, -33.45 + d], [-70.6, -33.45]]]}


def state(sid, status="en_curso", rev=1):
    return {
        "id": sid, "codigo": "D-TEST", "instrument_version": "1.0.0", "interviewer": {"email": "x", "name": "x"},
        "meta": {"started_at": "2027-01-10T14:00:00Z", "completed_at": "2027-01-10T14:45:00Z" if status == "completada" else None, "lugar": "domicilio"},
        "consent": {"cuidador": {"modo": "app", "acepta": True, "audio": True}},
        "answers": {"A1a": 1, "A1b": 1, "A1c": 1, "A3": 1, "tratamiento": "f", "comuna": "Ñuñoa", "B1_estado": "dibujado", "B2_estado": "dibujado",
                    "B3_estado": "marcado", "D1": 5, "D2": 3, "D3": 2, "D4": 1, "E1": 4, "E2": 2, "E3": -88, "E_orden": ["E2", "E1"],
                    "G1": 27, "G2": 1, "G3": 4, "G6": [1, 2], "G7": [2], "H1": 58, "H3": 6, "H9": 5, "H11": 1, "H11r": [1, 5], "H11r_otro": "trabajo",
                    "destinos": [{"id": "d1", "C2": 3, "C4": 5, "C5": 4, "C6": [3, 6], "C10_estado": "trazada", "C10_alt": 0},
                                 {"id": "d2", "C2": 7, "C4": 3, "C5": 1, "C6": [1]}],
                    "C7": ["d1"], "P": {"aplicado": 1, "variante": "taller", "P1a": "la plaza", "control": [{"id": "auto", "esperado": 0, "respuesta": 1}],
                                         "P3": {"comprar": 1, "micro": 2}, "P4": {"comprar": 1, "micro": 1}}},
        "geo": {"nombre": "Antonia", "direccion": "Av. Irarrázaval 1234, Ñuñoa", "home": {"lng": -70.598, "lat": -33.448, "fuente": "geocodificador"},
                "B1": {"geometry": poly()}, "B2": {"geometry": poly(0.01)},
                "B3": [{"id": "p1", "tipo": "punto", "geometry": {"type": "Point", "coordinates": [-70.599, -33.449]}, "nota": "cruce"}],
                "destinos": {"d1": {"nombre": "Almacén", "lng": -70.597, "lat": -33.447}, "d2": {"nombre": "Plaza", "lng": -70.59, "lat": -33.44}},
                "rutas": {"d1": {"geometry": {"type": "LineString", "coordinates": [[-70.598, -33.448], [-70.597, -33.447]]}}}},
        "mapas": {"B1": {"estilo": "calles", "intentos": 2, "draw_ms": 18000, "modo": "libre", "zoom": 15.2}},
        "timings": {"A3": {"ms": 4000, "visits": 1, "first_ms": 2100, "changes": 0}, "B1": {"ms": 95000, "visits": 1}, "E1": {"ms": 7000, "visits": 1}},
    }


def test_full_flow():
    with TestClient(app) as c:
        assert c.put("/api/surveys/s1", json={"rev": 1, "status": "en_curso", "state": state("s1")}).status_code == 401
        assert c.post("/api/auth/login", json={"email": "jaleonhardt@uc.cl", "password": "mala"}).status_code == 401
        adm = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "JALEONHARDT@uc.cl", "password": "clave-admin"}).json()["token"]}

        iv = c.post("/api/admin/interviewers", json={"name": "Ana Soto", "email": "ana@uc.cl"}, headers=adm).json()
        tok = c.post("/api/auth/login", json={"email": "ana@uc.cl", "password": iv["code"].lower()}).json()
        assert tok["role"] == "interviewer"
        h = {"Authorization": "Bearer " + tok["token"]}
        assert c.get("/api/admin/summary", headers=h).status_code == 403
        cfg = c.get("/api/config", headers=h).json()
        assert cfg["settings"]["incluir_reserva"] is True

        # eventos y audio antes de que exista la encuesta: el tablet debe reintentar
        assert c.post("/api/surveys/s1/events", json={"events": [{"seq": 1, "t": "x", "type": "a"}]}, headers=h).status_code == 409

        r = c.put("/api/surveys/s1", json={"rev": 1, "status": "en_curso", "state": state("s1")}, headers=h).json()
        assert r["created"] and len(sent) == 1 and "inicio" in sent[0][0]
        # reintento idéntico y versión antigua: no duplican ni retroceden
        c.put("/api/surveys/s1", json={"rev": 3, "status": "en_curso", "state": state("s1")}, headers=h)
        stale = c.put("/api/surveys/s1", json={"rev": 2, "status": "en_curso", "state": state("s1")}, headers=h).json()
        assert stale["stale"] and stale["rev"] == 3 and len(sent) == 1

        ev = [{"seq": i, "t": "2027-01-10T14:00:00Z", "type": "screen_enter", "item": "A3"} for i in range(1, 6)]
        assert c.post("/api/surveys/s1/events", json={"events": ev}, headers=h).json()["added"] == 5
        assert c.post("/api/surveys/s1/events", json={"events": ev + [{"seq": 6, "t": "x", "type": "answer"}]}, headers=h).json()["added"] == 1
        for seq, chunk in enumerate([b"AAAA", b"BBBB", b"CC"]):
            assert c.put(f"/api/surveys/s1/audio/0/{seq}", content=chunk, headers={**h, "content-type": "audio/webm;codecs=opus"}).status_code == 200
        c.put("/api/surveys/s1/audio/0/1", content=b"XXXX", headers={**h, "content-type": "audio/webm"})  # duplicado: se ignora

        c.put("/api/surveys/s1", json={"rev": 4, "status": "completada", "state": state("s1", "completada")}, headers=h)
        assert len(sent) == 2 and "completada" in sent[1][0] and "Antonia" not in sent[1][1] and "Irarrázaval" not in sent[1][1]
        c.put("/api/surveys/s1", json={"rev": 5, "status": "completada", "state": state("s1", "completada")}, headers=h)
        assert len(sent) == 2
        rec = c.get("/api/surveys/s1/receipt", headers=h).json()
        assert rec == {"rev": 5, "status": "completada", "events": 6, "max_seq": 6, "audio": {"0": 3}}

        # lo sensible queda cifrado y separado
        db = SessionLocal()
        raw = bytes(db.get(SurveySensitive, "s1").payload)
        db.close()
        assert b"Antonia" not in raw and b"Irarr" not in raw
        lst = c.get("/api/admin/surveys", headers=adm).json()["surveys"]
        assert "Antonia" not in json.dumps(lst)

        # otro encuestador no puede escribir en una encuesta ajena
        iv2 = c.post("/api/admin/interviewers", json={"name": "Beto", "email": "beto@uc.cl"}, headers=adm).json()
        h2 = {"Authorization": "Bearer " + c.post("/api/auth/login", json={"email": "beto@uc.cl", "password": iv2["code"]}).json()["token"]}
        assert c.put("/api/surveys/s1", json={"rev": 9, "status": "en_curso", "state": state("s1")}, headers=h2).status_code == 403

        det = c.get("/api/admin/surveys/s1", headers=adm).json()
        assert det["geo"]["nombre"] == "Antonia" and det["audio"][0]["chunks"] == 3
        assert c.get("/api/admin/surveys/s1/audio/0", headers=adm).content == b"AAAABBBBCC"

        summ = c.get("/api/admin/summary", headers=adm).json()
        assert summ["counts"]["validas"] == 1 and summ["por_comuna"][0] == {"comuna": "Ñuñoa", "validas": 1, "en_curso": 0}
        assert summ["duraciones"]["bloques"][1]["mediana"] == 1.6

        z = zipfile.ZipFile(io.BytesIO(c.get("/api/admin/export", headers=adm).content))
        names = set(z.namelist())
        assert {"diadas.csv", "diadas.json", "destinos.csv", "tiempos_items.csv", "eventos.jsonl", "diccionario_variables.csv",
                "geo/b1_sin_acompanamiento.geojson", "geo/rutas_c10.geojson"} <= names
        import csv
        rows = list(csv.DictReader(io.StringIO(z.read("diadas.csv").decode("utf-8-sig"))))
        assert len(rows) == 1
        row = rows[0]
        assert row["D_indice"] == "11" and row["G6_tea"] == "1" and row["G6_motora"] == "0" and row["H11r_otro_txt"] == "trabajo"
        assert row["B1_contiene_hogar"] == "1" and 120000 < float(row["B1_area_m2"]) < 180000 and row["B1_dibujo_ms"] == "18000"
        assert row["P2_aquiescencia"] == "1" and row["P3_micro"] == "2" and row["E3"] == "-88" and row["dur_B_s"] == "95.0"
        dests = list(csv.DictReader(io.StringIO(z.read("destinos.csv").decode("utf-8-sig"))))
        assert len(dests) == 2 and dests[0]["C7_orden"] == "1" and dests[0]["C6_llaman"] == "1" and float(dests[0]["C10_longitud_m"]) > 100
        b1 = json.loads(z.read("geo/b1_sin_acompanamiento.geojson"))
        assert b1["features"][0]["properties"]["id_diada"] == "s1"
        assert len(z.read("eventos.jsonl").decode().splitlines()) == 6

        # marcar como prueba la saca de la síntesis; eliminar deja una lápida que bloquea resubidas
        c.patch("/api/admin/surveys/s1", json={"is_test": True}, headers=adm)
        assert c.get("/api/admin/summary", headers=adm).json()["counts"]["validas"] == 0
        assert c.delete("/api/admin/surveys/s1", headers=adm).json()["ok"]
        assert c.put("/api/surveys/s1", json={"rev": 6, "status": "completada", "state": state("s1", "completada")}, headers=h).status_code == 410
        assert c.get("/api/admin/surveys", headers=adm).json()["surveys"] == []

        c.patch(f"/api/admin/interviewers/{iv['id']}", json={"active": False}, headers=adm)
        assert c.get("/api/config", headers=h).status_code == 401

        s = c.put("/api/admin/settings", json={"fase": "levantamiento", "tareas": {"C10": False}, "otra": 1}, headers=adm).json()
        assert s["fase"] == "levantamiento" and s["tareas"] == {"B3": True, "C8": True, "C9": True, "C10": False} and "otra" not in s
