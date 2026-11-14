"""Exportación para análisis: una fila por díada, tablas largas y capas GeoJSON, todas unidas por `id_diada`."""
import csv
import io
import json
import zipfile
from datetime import datetime, timezone

from .config import settings
from .geo import haversine, line_length, point_in_polygon, polygon_area, polygon_perimeter

INSTRUMENT = json.loads(settings.instrument_path.read_text(encoding="utf-8"))
ITEMS = INSTRUMENT["items"]
SCALES = INSTRUMENT["scales"]
P = INSTRUMENT["P"]
BLOCK_IDS = [b["id"] for b in INSTRUMENT["blocks"]]
TOP_ITEMS = [k for k, v in ITEMS.items() if not v.get("perDestination")]
DEST_ITEMS = [k for k, v in ITEMS.items() if v.get("perDestination")]


def options(item: dict) -> list[dict]:
    return item.get("options") or SCALES[item["scale"]]


def clean(text: str) -> str:
    """Quita las marcas de género del texto del instrumento, dejando la forma neutra."""
    import re
    return re.sub(r"\{([^|}]*)\|([^|}]*)\|([^}]*)\}", lambda m: m.group(3), text)


def _iso(dt) -> str:
    return dt.astimezone(timezone.utc).isoformat() if isinstance(dt, datetime) else (dt or "")


def block_of(item_id: str) -> str:
    base = item_id.split(".")[0]
    if base in ("consentimiento", "inicio", "cierre"):
        return base
    return base[0] if base[0] in BLOCK_IDS else "otro"


def flat_row(s, resp: dict, geo: dict) -> dict:
    a = resp.get("answers", {}) or {}
    meta = resp.get("meta", {}) or {}
    cons = resp.get("consent", {}) or {}
    mapas = resp.get("mapas", {}) or {}
    timings = resp.get("timings", {}) or {}
    home = (geo.get("home") or {})
    hp = [home["lng"], home["lat"]] if home.get("lng") is not None else None
    row: dict = {
        "id_diada": s.id, "codigo": s.codigo, "estado": s.status,
        "es_prueba": int(s.is_test), "excluida": int(s.excluded),
        "encuestador": s.interviewer_name, "encuestador_correo": s.interviewer_email,
        "inicio": _iso(s.started_at), "termino": _iso(s.completed_at),
        "duracion_min": round((s.completed_at - s.started_at).total_seconds() / 60, 2) if s.started_at and s.completed_at else "",
        "version_instrumento": resp.get("instrument_version", ""),
        "fase": (resp.get("config") or {}).get("fase", ""),
        "lugar_aplicacion": meta.get("lugar", ""), "lugar_aplicacion_otro": meta.get("lugar_otro", ""),
        "motivo_termino": meta.get("end_reason", ""),
        "consent_cuidador_modo": (cons.get("cuidador") or {}).get("modo", ""),
        "consent_cuidador_acepta": _b((cons.get("cuidador") or {}).get("acepta")),
        "consent_audio": _b((cons.get("cuidador") or {}).get("audio")),
        "consent_persona_modo": (cons.get("persona") or {}).get("modo", ""),
        "consent_persona_acepta": _b((cons.get("persona") or {}).get("acepta")),
        "consent_persona_comprension": _b((cons.get("persona") or {}).get("comprension")),
        "nombre_persona": geo.get("nombre", ""), "tratamiento": a.get("tratamiento", ""),
        "direccion": geo.get("direccion", ""), "comuna": s.comuna or "",
        "hogar_lng": home.get("lng", ""), "hogar_lat": home.get("lat", ""), "hogar_fuente": home.get("fuente", ""),
    }
    for b in BLOCK_IDS:
        ms = sum(t.get("ms", 0) for k, t in timings.items() if block_of(k) == b)
        row[f"dur_{b}_s"] = round(ms / 1000, 1) if ms else ""

    for k in TOP_ITEMS:
        it = ITEMS[k]
        v = a.get(k)
        if it["type"] == "multi":
            sel = v if isinstance(v, list) else None
            for o in it["options"]:
                row[f"{k}_{o['key']}"] = "" if sel is None else (-99 if sel == [-99] else int(o["code"] in sel))
            if it.get("otherCode") is not None:
                row[f"{k}_otro_txt"] = a.get(f"{k}_otro", "")
        else:
            row[k] = "" if v is None else v
            if it.get("otherCode") is not None:
                row[f"{k}_otro_txt"] = a.get(f"{k}_otro", "")
    d = [a.get(f"D{i}") for i in range(1, 5)]
    row["D_indice"] = sum(d) if all(isinstance(x, (int, float)) and x > 0 for x in d) else ""
    row["E_orden"] = " ".join(a.get("E_orden") or [])
    row["F_orden"] = " ".join(a.get("F_orden") or [])

    for key in ("B1", "B2"):
        g = (geo.get(key) or {}).get("geometry")
        m = mapas.get(key) or {}
        row[f"{key}_estado"] = a.get(f"{key}_estado", "")
        row[f"{key}_area_m2"] = round(polygon_area(g), 1) if g else ""
        row[f"{key}_perimetro_m"] = round(polygon_perimeter(g), 1) if g else ""
        row[f"{key}_n_vertices"] = len(g["coordinates"][0]) - 1 if g else ""
        row[f"{key}_contiene_hogar"] = int(point_in_polygon(hp, g)) if g and hp else ""
        row[f"{key}_intentos"] = m.get("intentos", "")
        row[f"{key}_dibujo_ms"] = m.get("draw_ms", "")
        row[f"{key}_modo_dibujo"] = m.get("modo", "")
        row[f"{key}_estilo_mapa"] = m.get("estilo", "")
        row[f"{key}_cambios_estilo"] = m.get("cambios_estilo", 0) if m else ""
        row[f"{key}_zoom"] = m.get("zoom", "")
        row[f"{key}_pantalla_ms"] = (timings.get(key) or {}).get("ms", "")
    b3 = geo.get("B3") or []
    row["B3_estado"] = a.get("B3_estado", "")
    row["B3_n_puntos"] = sum(1 for f in b3 if f.get("tipo") == "punto")
    row["B3_n_tramos"] = sum(1 for f in b3 if f.get("tipo") == "tramo")

    dests = a.get("destinos") or []
    row["C_n_destinos"] = len(dests)
    row["C_n_solo"] = sum(1 for x in dests if x.get("C5") in (3, 4))
    row["C_n_rutas"] = len(geo.get("rutas") or {})

    p = a.get("P") or {}
    row["P_aplicado"] = p.get("aplicado", "")
    row["P_razon_no_aplica"] = p.get("razon", "")
    row["P_razon_otro_txt"] = p.get("razon_otro", "")
    row["P_espacio_separado"] = p.get("separado", "")
    row["P_detenido"] = _b(p.get("detenido"))
    row["P_variante_actividad"] = p.get("variante", "")
    row["P1a_lugar_favorito"] = p.get("P1a", "")
    row["P1b_con_quien"] = p.get("P1b", "")
    ctrl = {c["id"]: c for c in (p.get("control") or [])}
    n_ctrl = n_ok = n_acq = 0
    for c in P["control"]:
        got = ctrl.get(c["id"])
        row[f"P2_{c['id']}_esperado"] = got.get("esperado", "") if got else ""
        row[f"P2_{c['id']}_respuesta"] = got.get("respuesta", "") if got and got.get("respuesta") is not None else ""
        if got and got.get("respuesta") in (0, 1) and got.get("esperado") in (0, 1):
            n_ctrl += 1
            n_ok += int(got["respuesta"] == got["esperado"])
            n_acq += int(got["esperado"] == 0 and got["respuesta"] == 1)
    row["P2_n_control"] = n_ctrl or ""
    row["P2_n_correctas"] = n_ok if n_ctrl else ""
    row["P2_aquiescencia"] = int(n_acq > 0) if n_ctrl else ""
    for act in P["actividades"]:
        row[f"P3_{act['id']}"] = (p.get("P3") or {}).get(act["id"], "")
    for act in P["actividades"]:
        row[f"P4_{act['id']}"] = (p.get("P4") or {}).get(act["id"], "")
    row["n_notas_encuestador"] = len(resp.get("notas") or [])
    return row


def _b(v):
    return "" if v is None else int(bool(v))


def dest_rows(s, resp: dict, geo: dict) -> list[dict]:
    a = resp.get("answers", {}) or {}
    home = geo.get("home") or {}
    hp = [home["lng"], home["lat"]] if home.get("lng") is not None else None
    gd, routes = geo.get("destinos") or {}, geo.get("rutas") or {}
    mapas = resp.get("mapas", {}) or {}
    out = []
    for n, d in enumerate(a.get("destinos") or [], start=1):
        loc = gd.get(d["id"]) or {}
        pt = [loc["lng"], loc["lat"]] if loc.get("lng") is not None else None
        row = {"id_diada": s.id, "codigo": s.codigo, "destino_n": n, "destino_id": d["id"],
               "C1_nombre": loc.get("nombre", ""), "C2": d.get("C2", ""), "C2_otro_txt": d.get("C2_otro", ""),
               "C3_lng": loc.get("lng", ""), "C3_lat": loc.get("lat", ""), "C3_fuente": loc.get("fuente", ""),
               "dist_recta_hogar_m": round(haversine(hp, pt), 1) if hp and pt else "",
               "C4": d.get("C4", ""), "C5": d.get("C5", "")}
        sel = d.get("C6") if isinstance(d.get("C6"), list) else None
        for o in ITEMS["C6"]["options"]:
            row[f"C6_{o['key']}"] = "" if sel is None else (-99 if sel == [-99] else int(o["code"] in sel))
        row["C6_otro_txt"] = d.get("C6_otro", "")
        for k in ("C7", "C8", "C9"):
            order = a.get(k) or []
            row[f"{k}_orden"] = order.index(d["id"]) + 1 if d["id"] in order else ""
        r = routes.get(d["id"])
        row["C10_estado"] = d.get("C10_estado", "")
        row["C10_caminos_alternativos"] = d.get("C10_alt", "") if d.get("C10_alt") is not None else ""
        row["C10_longitud_m"] = round(line_length(r["geometry"]["coordinates"]), 1) if r else ""
        row["C10_dibujo_ms"] = (mapas.get(f"C10.{d['id']}") or {}).get("draw_ms", "")
        out.append(row)
    return out


def _feat(geometry, props):
    return {"type": "Feature", "geometry": geometry, "properties": props}


def _fc(features):
    return {"type": "FeatureCollection", "name": "encuesta_diadas",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}}, "features": features}


def geo_layers(records) -> dict[str, dict]:
    layers = {k: [] for k in ("hogares", "b1_sin_acompanamiento", "b2_acompanado", "b3_preocupaciones", "destinos", "rutas_c10")}
    for s, resp, geo in records:
        a = resp.get("answers", {}) or {}
        mapas = resp.get("mapas", {}) or {}
        base = {"id_diada": s.id, "codigo": s.codigo, "comuna": s.comuna}
        home = geo.get("home") or {}
        if home.get("lng") is not None:
            layers["hogares"].append(_feat({"type": "Point", "coordinates": [home["lng"], home["lat"]]},
                                           {**base, "fuente": home.get("fuente")}))
        for key, layer in (("B1", "b1_sin_acompanamiento"), ("B2", "b2_acompanado")):
            g = (geo.get(key) or {}).get("geometry")
            if g:
                m = mapas.get(key) or {}
                layers[layer].append(_feat(g, {**base, "item": key, "area_m2": round(polygon_area(g), 1),
                                               "estilo_mapa": m.get("estilo"), "modo_dibujo": m.get("modo"),
                                               "intentos": m.get("intentos"), "dibujo_ms": m.get("draw_ms")}))
        for n, f in enumerate(geo.get("B3") or [], start=1):
            layers["b3_preocupaciones"].append(_feat(f["geometry"], {**base, "n": n, "tipo": f.get("tipo"), "nota": f.get("nota", "")}))
        gd, routes = geo.get("destinos") or {}, geo.get("rutas") or {}
        for n, d in enumerate(a.get("destinos") or [], start=1):
            loc = gd.get(d["id"]) or {}
            props = {**base, "destino_n": n, "destino_id": d["id"], "nombre": loc.get("nombre", ""),
                     "C2": d.get("C2"), "C4": d.get("C4"), "C5": d.get("C5")}
            if loc.get("lng") is not None:
                layers["destinos"].append(_feat({"type": "Point", "coordinates": [loc["lng"], loc["lat"]]}, props))
            r = routes.get(d["id"])
            if r:
                layers["rutas_c10"].append(_feat(r["geometry"], {**props, "caminos_alternativos": d.get("C10_alt"),
                                                                 "longitud_m": round(line_length(r["geometry"]["coordinates"]), 1)}))
    return {k: _fc(v) for k, v in layers.items()}


def timing_rows(s, resp) -> list[dict]:
    return [{"id_diada": s.id, "codigo": s.codigo, "item": k, "bloque": block_of(k),
             "ms_total": t.get("ms", 0), "visitas": t.get("visits", 0),
             "ms_hasta_primera_respuesta": t.get("first_ms", ""), "n_cambios_respuesta": t.get("changes", 0),
             "primera_vez_mostrado": t.get("first_shown", "")}
            for k, t in (resp.get("timings") or {}).items()]


def codebook() -> list[dict]:
    rows = []

    def add(var, label, tipo, valores=""):
        rows.append({"variable": var, "etiqueta": label, "tipo": tipo, "valores": valores})

    add("id_diada", "Identificador único de la díada (llave para unir todas las tablas y capas)", "texto")
    add("codigo", "Código corto legible de la díada", "texto")
    add("estado", "Estado de la encuesta", "categórica", "en_curso; completada; terminada_filtro; interrumpida")
    add("tratamiento", "Forma de tratamiento usada para redactar los ítems", "categórica", "m = él; f = ella")
    for k in TOP_ITEMS:
        it = ITEMS[k]
        extra = ""
        if it.get("latent"):
            extra = f" [latente {it['latent']}*, sentido {'+' if it['sense'] > 0 else '-'}{', reserva' if it.get('reserve') else ''}]"
        if it["type"] == "multi":
            for o in it["options"]:
                add(f"{k}_{o['key']}", f"{it['label']}: {clean(o['label'])}", "dicotómica", "1 = marcado; 0 = no marcado")
        elif it["type"] == "number":
            add(k, it["label"], "numérica", it.get("unit", ""))
        else:
            add(k, it["label"] + extra, "categórica", "; ".join(f"{o['code']} = {clean(o['label'])}" for o in options(it)))
        if it.get("otherCode") is not None:
            add(f"{k}_otro_txt", f"{it['label']}: texto de la opción otro", "texto")
    add("D_indice", "Índice global de licencias (suma de D1 a D4; 4 a 20)", "numérica")
    add("E_orden / F_orden", "Orden aleatorio en que se presentaron los ítems del bloque", "texto")
    for key, lab in (("B1", "polígono sin acompañamiento"), ("B2", "polígono acompañado")):
        add(f"{key}_estado", f"Estado del {lab}", "categórica", "dibujado; vacio (no camina a ningún lugar en esa condición); omitido")
        add(f"{key}_area_m2", f"Área del {lab}", "numérica", "m²")
        add(f"{key}_dibujo_ms", f"Tiempo efectivo de trazado del {lab}, sumando intentos", "numérica", "ms")
        add(f"{key}_intentos", "Número de trazados iniciados", "numérica")
        add(f"{key}_estilo_mapa", "Estilo de mapa visible al terminar el trazado", "texto")
    for k in DEST_ITEMS:
        it = ITEMS[k]
        if it["type"] == "multi":
            for o in it["options"]:
                add(f"{k}_{o['key']} (destinos.csv)", f"{it['label']}: {clean(o['label'])}", "dicotómica", "1; 0")
        else:
            add(f"{k} (destinos.csv)", it["label"], "categórica", "; ".join(f"{o['code']} = {clean(o['label'])}" for o in options(it)))
    add("C7_orden, C8_orden, C9_orden (destinos.csv)", "Posición del destino en el orden de aprendizaje, facilidad e importancia", "numérica", "1 = primero, más fácil, más importante")
    add("C10_caminos_alternativos (destinos.csv)", "Usa más de un camino para llegar", "dicotómica", "1 = sí; 0 = no")
    for name in ("P3", "P4"):
        cats = "; ".join(f"{c['code']} = {clean(c['label'])}" for c in P[name]["categorias"])
        for act in P["actividades"]:
            add(f"{name}_{act['id']}", f"{P[name]['pregunta']} {act['label']}", "categórica", cats + "; -99 = sin respuesta")
    add("P2_aquiescencia", "Dijo que sí hace una actividad de control que, según el cuidador, no realiza", "dicotómica", "1; 0")
    add("P_razon_no_aplica", "Razón por la que no se aplicó el módulo P", "categórica",
        "; ".join(f"{c['code']} = {c['label']}" for c in P["noAplicaRazones"]))
    add("(valores perdidos)", "Códigos de valores perdidos en ítems cerrados", "", "-88 = no sabe; -99 = sin respuesta; vacío = no corresponde o no aplicado")
    return rows


def _csv(rows: list[dict]) -> str:
    if not rows:
        return ""
    cols: list[str] = []
    for r in rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return "﻿" + buf.getvalue()


LEEME = """ENCUESTA DE DÍADAS: EXPORTACIÓN DE DATOS
Generado: {ts}
Encuestas incluidas: {n}

Todas las tablas y capas se unen por `id_diada`.

diadas.csv              Una fila por díada, con todos los ítems cerrados, medidas de B1 y B2, módulo P y duraciones por bloque.
diadas.json             Registro completo y anidado de cada díada (respuestas, geometrías, mapas, tiempos, notas).
destinos.csv            Una fila por destino (bloque C): tipo, frecuencia, régimen, apoyos, órdenes C7 a C9 y ruta C10.
tiempos_items.csv       Una fila por díada e ítem: tiempo en pantalla, latencia de la primera respuesta y cambios.
eventos.jsonl           Bitácora cronológica completa (paradatos): cada pantalla, respuesta, trazado, cambio de estilo de mapa, conexión y audio.
diccionario_variables.csv  Etiquetas y códigos de cada variable.
geo/hogares.geojson               Domicilios geocodificados (puntos).
geo/b1_sin_acompanamiento.geojson Polígonos B1 (Barrio Caminable Atribuido).
geo/b2_acompanado.geojson         Polígonos B2.
geo/b3_preocupaciones.geojson     Puntos y tramos del mapa de preocupaciones.
geo/destinos.geojson              Destinos frecuentes (puntos).
geo/rutas_c10.geojson             Rutas trazadas a los destinos a los que va sin compañía.

Sistema de coordenadas: WGS84 (EPSG:4326), longitud y latitud.
Ítems Likert de E y F: se exportan tal como se respondieron (1 a 5). El sentido (+ o -) de cada indicador está en el diccionario.
Licencias D1 a D4: 5 = sí, siempre; 1 = no, nunca.

DATOS SENSIBLES. Este archivo contiene domicilios, nombres y geometrías que permiten identificar a los participantes.
Debe guardarse cifrado y no compartirse. Solo se publican medidas derivadas.
"""


def build_zip(records, events_by_survey) -> bytes:
    """records: lista de (Survey, responses, geo)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("LEEME.txt", LEEME.format(ts=datetime.now(timezone.utc).isoformat(), n=len(records)))
        z.writestr("diadas.csv", _csv([flat_row(*r) for r in records]))
        z.writestr("destinos.csv", _csv([row for r in records for row in dest_rows(*r)]))
        z.writestr("tiempos_items.csv", _csv([row for s, resp, _ in records for row in timing_rows(s, resp)]))
        z.writestr("diccionario_variables.csv", _csv(codebook()))
        full = [{"id_diada": s.id, "codigo": s.codigo, "estado": s.status, "es_prueba": s.is_test, "excluida": s.excluded,
                 "comuna": s.comuna, "inicio": _iso(s.started_at), "termino": _iso(s.completed_at),
                 **{k: v for k, v in resp.items() if k not in ("id", "codigo", "status")}, "geo": geo}
                for s, resp, geo in records]
        z.writestr("diadas.json", json.dumps(full, ensure_ascii=False, indent=1))
        for name, fc in geo_layers(records).items():
            z.writestr(f"geo/{name}.geojson", json.dumps(fc, ensure_ascii=False))
        lines = []
        for s, _, _ in records:
            for e in events_by_survey.get(s.id, []):
                lines.append(json.dumps({"id_diada": s.id, **e}, ensure_ascii=False))
        z.writestr("eventos.jsonl", "\n".join(lines))
    return buf.getvalue()
