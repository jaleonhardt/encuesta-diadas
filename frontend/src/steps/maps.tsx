import { useEffect, useMemo, useRef, useState } from 'react';
import { Choices, TextInput } from '../components/ui';
import { MapCanvas, type DrawResult, type MapHandle, type Marker, type Tool } from '../components/MapCanvas';
import { soloDests } from '../lib/flow';
import { bounds, lineLength, ringArea, selfIntersects, type XY } from '../lib/geom';
import { INSTRUMENT, ITEMS, optionsOf } from '../lib/instrument';
import { uid } from '../lib/store';
import { homeOf, mapLog, T, type StepProps } from './common';

const feat = (geometry: any, kind: string, extra: any = {}) => ({ type: 'Feature', geometry, properties: { kind, ...extra } });
const now = () => new Date().toISOString();

const CONSIGNA: Record<string, string> = {
  B1: 'Pensando en su vida diaria, dibuje en el mapa el área por donde [NOMBRE] puede caminar desde su casa sin que nadie vaya a su lado, aunque {lo|la|lo} llamen por teléfono o {lo|la|lo} esperen al llegar.',
  B2: 'Ahora dibuje el área por donde [NOMBRE] camina en su vida diaria cuando va con usted o con otra persona.',
  B3: 'Marque los lugares, cruces o tramos de calle que le preocupan cuando [NOMBRE] anda sin compañía.',
  C10: 'Trace en el mapa el camino que hace [NOMBRE] habitualmente para llegar a este lugar. Si usa más de un camino, trace el más frecuente.',
};
const VACIO: Record<string, string> = {
  B1: '[NOMBRE] no camina {solo|sola|sin compañía} a ningún lugar',
  B2: '[NOMBRE] no camina {acompañado|acompañada|con compañía} por el barrio',
};

/** Registra en la bitácora y en `mapas` el inicio y el término de cada trazado. */
function useDrawLog(session: StepProps['session'], item: string, map: React.RefObject<MapHandle>) {
  return {
    start: () => {
      session.update((s) => { const m = (s.mapas[item] ??= {}); m.intentos = (m.intentos ?? 0) + 1; m.t_inicio ??= now(); const t = s.timings[item]; if (t && t.first_ms === undefined) t.first_ms = t.ms; });
      session.event('draw_start', item);
    },
    end: (r: DrawResult, extra: any = {}) => {
      const info = map.current?.info();
      session.update((s) => {
        const m = (s.mapas[item] ??= {});
        m.draw_ms = (m.draw_ms ?? 0) + r.ms; m.ultimo_ms = r.ms; m.modo = r.modo; m.t_fin = now();
        m.zoom = info?.zoom; m.estilo = info?.estilo ?? m.estilo; m.n_trazo = r.n_trazo; Object.assign(m, extra);
      });
      session.event('draw_end', item, { ms: r.ms, modo: r.modo, n_trazo: r.n_trazo, zoom: info?.zoom, estilo: info?.estilo, ...extra });
    },
  };
}

function DrawDemo() {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" aria-hidden="true">
      <path d="M32 6C18 5 6 13 7 26s14 17 27 16 23-8 22-20S46 7 32 6z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="130" strokeDashoffset="130">
        <animate attributeName="stroke-dashoffset" from="130" to="0" dur="2.4s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

export function PolygonStep({ session, state, step, token }: StepProps) {
  const key = step.id as 'B1' | 'B2';
  const map = useRef<MapHandle>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [nVert, setNVert] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [showPrev, setShowPrev] = useState(false);
  const home = homeOf(state)!;
  const log = useMemo(() => mapLog(session, key), [session, key]);
  const dl = useDrawLog(session, key, map);
  const geom = state.geo[key]?.geometry;
  const estado = state.answers[`${key}_estado`];
  const kind = key.toLowerCase();

  const features = useMemo(() => [
    ...(geom ? [feat(geom, kind)] : []),
    ...(key === 'B2' && showPrev && state.geo.B1?.geometry ? [feat(state.geo.B1.geometry, 'ctx')] : []),
  ], [geom, showPrev, key, kind, state.geo.B1]);

  const drawn = (r: DrawResult) => {
    const ring = r.geometry.coordinates[0] as XY[];
    const extra = { n_vertices: ring.length - 1, autointerseccion: selfIntersects(ring), area_m2: Math.round(ringArea(ring)) };
    session.update((s) => {
      if (s.geo[key]?.geometry) (s.geo[`${key}_descartados`] ??= []).push(s.geo[key].geometry);
      s.geo[key] = { geometry: r.geometry, trazo: r.trazo ?? null };
      s.answers[`${key}_estado`] = 'dibujado';
    });
    dl.end(r, extra);
    setTool(null); setMsg(null);
  };
  const setEstado = (v: string) => {
    session.update((s) => { if (s.geo[key]?.geometry) (s.geo[`${key}_descartados`] ??= []).push(s.geo[key].geometry); s.geo[key] = null; });
    session.answer(`${key}_estado`, v, { item: key });
    setTool(null);
  };

  return (
    <MapCanvas ref={map} token={token} center={home} tool={tool} features={features} markers={[{ id: 'home', kind: 'home', lng: home[0], lat: home[1] }]}
      {...log} onDrawStart={dl.start} onDrawn={drawn} onVertices={setNVert}
      onTooShort={() => { setMsg('El trazo fue muy corto. Mantenga el dedo sobre el mapa y dibuje todo el borde sin levantarlo.'); session.event('draw_short', key); }}>
      {!tool && (
        <div className="mapcard"><b className="t">{key}</b>{T(state, CONSIGNA[key])}</div>
      )}
      {tool === 'area-libre' && <div className="drawhint">Dibuje el borde con el dedo, sin levantarlo</div>}
      {tool === 'area-puntos' && <div className="drawhint">Toque el mapa para marcar cada esquina del área</div>}
      {msg && !tool && <div className="drawhint" style={{ background: 'var(--alerta)', whiteSpace: 'normal', textAlign: 'center', borderRadius: 18 }}>{msg}</div>}
      <div className="mapactions">
        {!tool && estado !== 'dibujado' && (
          <>
            <button type="button" className="btn primary" onClick={() => { setMsg(null); setTool('area-libre'); }}><DrawDemo />Dibujar el área</button>
            <button type="button" className="btn" aria-pressed={estado === 'vacio'} style={estado === 'vacio' ? { borderColor: 'var(--solo)', background: 'var(--solo-soft)' } : undefined} onClick={() => setEstado('vacio')}>{T(state, VACIO[key])}</button>
          </>
        )}
        {!tool && estado === 'dibujado' && (
          <>
            <span className="btn" style={{ borderColor: 'var(--solo)', background: 'var(--solo-soft)', pointerEvents: 'none' }}>Área dibujada</span>
            <button type="button" className="btn" onClick={() => { session.event('draw_redo', key); setTool('area-libre'); }}>Volver a dibujar</button>
            <button type="button" className="btn" onClick={() => setEstado('vacio')}>{T(state, VACIO[key])}</button>
          </>
        )}
        {!tool && key === 'B2' && state.geo.B1?.geometry && (
          <button type="button" className="btn sm" onClick={() => { setShowPrev((v) => !v); session.update((s) => { (s.mapas.B2 ??= {}).mostro_b1 = true; }); session.event('ver_b1', 'B2', { visible: !showPrev }); }}>{showPrev ? 'Ocultar el área anterior' : 'Ver el área anterior'}</button>
        )}
        {!tool && <button type="button" className="btn sm" onClick={() => setTool('area-puntos')}>Dibujar punto a punto</button>}
        {!tool && estado !== 'dibujado' && <button type="button" className="btn sm ghost" style={{ background: '#fff' }} onClick={() => setEstado('omitido')}>{estado === 'omitido' ? 'Marcado sin respuesta' : 'Sin respuesta'}</button>}
        {tool === 'area-puntos' && (
          <>
            <button type="button" className="btn" disabled={nVert === 0} onClick={() => map.current?.undoVertex()}>Deshacer</button>
            <button type="button" className="btn primary" disabled={nVert < 3} onClick={() => map.current?.closeVertices()}>Cerrar el área</button>
          </>
        )}
        {tool && <button type="button" className="btn" onClick={() => { setTool(null); session.event('draw_cancel', key); }}>Cancelar</button>}
      </div>
    </MapCanvas>
  );
}

export function ConcernsStep({ session, state, token }: StepProps) {
  const map = useRef<MapHandle>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const home = homeOf(state)!;
  const log = useMemo(() => mapLog(session, 'B3'), [session]);
  const dl = useDrawLog(session, 'B3', map);
  const marks: any[] = state.geo.B3 ?? [];
  const features = useMemo(() => marks.map((m) => feat(m.geometry, m.tipo)), [marks, marks.length]);

  const drawn = (r: DrawResult) => {
    const id = uid();
    const tipo = r.geometry.type === 'Point' ? 'punto' : 'tramo';
    session.update((s) => { s.geo.B3.push({ id, tipo, geometry: r.geometry, nota: '', t: now() }); s.answers.B3_estado = 'marcado'; });
    if (tipo === 'punto') dl.start();
    dl.end(r, { n_marcas: marks.length });
    setTool(null); setEdit(id);
  };
  const remove = (id: string) => {
    session.update((s) => { s.geo.B3 = s.geo.B3.filter((m: any) => m.id !== id); if (!s.geo.B3.length) delete s.answers.B3_estado; });
    session.event('mark_delete', 'B3');
    setEdit(null);
  };
  const editing = marks.find((m) => m.id === edit);

  return (
    <MapCanvas ref={map} token={token} center={home} tool={tool} features={features} markers={[{ id: 'home', kind: 'home', lng: home[0], lat: home[1] }]}
      {...log} onDrawStart={dl.start} onDrawn={drawn} onTooShort={() => session.event('draw_short', 'B3')}>
      {!tool && !editing && <div className="mapcard"><b className="t">B3</b>{T(state, CONSIGNA.B3)}{marks.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{marks.length === 1 ? '1 marca' : `${marks.length} marcas`}</div>}</div>}
      {editing && (
        <div className="mapcard stack" style={{ gap: 10 }}>
          <b className="t">{editing.tipo === 'punto' ? 'Lugar marcado' : 'Tramo marcado'}</b>
          <TextInput value={editing.nota} placeholder="¿Qué le preocupa aquí? (opcional)" onCommit={(v) => session.update((s) => { const m = s.geo.B3.find((x: any) => x.id === edit); if (m) m.nota = v; })} />
          <div className="row"><button type="button" className="btn sm primary" onClick={() => setEdit(null)}>Listo</button><button type="button" className="btn sm" onClick={() => remove(editing.id)}>Borrar esta marca</button></div>
        </div>
      )}
      {tool === 'punto' && <div className="drawhint">Toque el lugar o cruce que le preocupa</div>}
      {tool === 'linea-libre' && <div className="drawhint">Dibuje el tramo de calle con el dedo</div>}
      <div className="mapactions">
        {!tool && !editing && (
          <>
            <button type="button" className="btn primary" onClick={() => setTool('punto')}>Marcar un lugar o cruce</button>
            <button type="button" className="btn primary" onClick={() => setTool('linea-libre')}>Marcar un tramo de calle</button>
            {marks.length > 0 && <button type="button" className="btn sm" onClick={() => remove(marks[marks.length - 1].id)}>Borrar la última marca</button>}
            {marks.length === 0 && (
              <>
                <button type="button" className="btn" style={state.answers.B3_estado === 'sin_preocupaciones' ? { borderColor: 'var(--solo)', background: 'var(--solo-soft)' } : undefined}
                  onClick={() => session.answer('B3_estado', 'sin_preocupaciones', { item: 'B3' })}>No hay lugares que le preocupen</button>
                <button type="button" className="btn sm ghost" style={{ background: '#fff' }} onClick={() => session.answer('B3_estado', 'omitido', { item: 'B3' })}>{state.answers.B3_estado === 'omitido' ? 'Marcado sin respuesta' : 'Sin respuesta'}</button>
              </>
            )}
          </>
        )}
        {tool && <button type="button" className="btn" onClick={() => setTool(null)}>Cancelar</button>}
      </div>
    </MapCanvas>
  );
}

// ------------------------------------------------------------------ bloque C

const destOf = (state: any, id: string) => state.answers.destinos.find((d: any) => d.id === id);
const destIndex = (state: any, id: string) => state.answers.destinos.findIndex((d: any) => d.id === id) + 1;

export function DestNombreStep({ session, state, step, next }: StepProps) {
  const id = step.dest!;
  const d = destOf(state, id);
  const it = ITEMS.C2;
  return (
    <div className="question">
      <div className="qid">C1 y C2, lugar {destIndex(state, id)}</div>
      <div className="qtext">¿Qué lugar es?</div>
      <TextInput value={state.geo.destinos[id]?.nombre ?? ''} autoFocus placeholder="Nombre o referencia, por ejemplo: almacén de la esquina"
        onCommit={(v) => { session.update((s) => { (s.geo.destinos[id] ??= {}).nombre = v; }); session.event('answer', step.id, { key: 'C1' }); }} />
      <div className="lbl" style={{ marginBottom: -8 }}>{it.text}</div>
      <Choices cols2 options={optionsOf(it)} value={d.C2} onChange={(v) => { session.answer('C2', v, { item: step.id, path: (s) => destOf(s, id) }); if (v !== it.otherCode && state.geo.destinos[id]?.nombre?.trim()) setTimeout(next, 260); }} />
      {d.C2 === it.otherCode && <TextInput value={d.C2_otro ?? ''} placeholder="¿Qué tipo de lugar?" onCommit={(v) => session.answer('C2_otro', v, { item: step.id, path: (s) => destOf(s, id), logValue: false })} />}
    </div>
  );
}

async function searchPlaces(q: string, near: XY, token: string) {
  const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(q)}&proximity=${near.join(',')}&country=cl&language=es&limit=6&access_token=${token}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  const j = await r.json();
  return (j.features ?? []).map((f: any) => ({ label: [f.properties?.name, f.properties?.address ?? f.properties?.place_formatted].filter(Boolean).join(', '), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}

export function DestMapaStep({ session, state, step, token }: StepProps) {
  const id = step.dest!;
  const map = useRef<MapHandle>(null);
  const home = homeOf(state)!;
  const item = step.id;
  const log = useMemo(() => mapLog(session, item), [session, item]);
  const loc = state.geo.destinos[id] ?? {};
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const t0 = useRef(performance.now());

  const place = (lng: number, lat: number, fuente: string) => {
    const info = map.current?.info();
    session.update((s) => {
      Object.assign((s.geo.destinos[id] ??= {}), { lng, lat, fuente });
      const m = (s.mapas[item] ??= {}); m.intentos = (m.intentos ?? 0) + 1; m.ms_hasta_marca = Math.round(performance.now() - t0.current); m.zoom = info?.zoom; m.estilo = info?.estilo;
      delete destOf(s, id).C3_estado;
    });
    session.event('point_set', item, { fuente, zoom: info?.zoom, estilo: info?.estilo });
  };
  const markers: Marker[] = [
    { id: 'home', kind: 'home', lng: home[0], lat: home[1] },
    ...state.answers.destinos.filter((d: any) => state.geo.destinos[d.id]?.lng != null).map((d: any) => ({ id: d.id, kind: 'dest' as const, lng: state.geo.destinos[d.id].lng, lat: state.geo.destinos[d.id].lat, label: String(destIndex(state, d.id)), dim: d.id !== id })),
  ];
  const run = async () => {
    if (q.trim().length < 3) return;
    setSearching(true);
    try { const r = await searchPlaces(q, home, token); setHits(r); session.event('place_search', item, { resultados: r.length }); }
    catch { setHits([]); }
    finally { setSearching(false); }
  };

  return (
    <MapCanvas ref={map} token={token} center={loc.lng != null ? [loc.lng, loc.lat] : home} zoom={15.2} tool="punto" markers={markers} {...log}
      onDrawn={(r) => place(r.geometry.coordinates[0], r.geometry.coordinates[1], 'toque')}>
      <div className="mapcard stack" style={{ gap: 10 }}>
        <div><b className="t">C3, lugar {destIndex(state, id)}</b>Toque en el mapa dónde queda <b>{loc.nombre || 'este lugar'}</b>.</div>
        <div className="row">
          <input className="field" style={{ minHeight: 48, fontSize: '1rem' }} placeholder="O busque el lugar por nombre o dirección" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
          <button type="button" className="btn sm" disabled={searching} onClick={run}>{searching ? 'Buscando' : 'Buscar'}</button>
        </div>
        {hits && (hits.length ? (
          <div className="choices" style={{ maxHeight: 200, overflow: 'auto' }}>
            {hits.map((h, i) => <button key={i} type="button" className="choice" style={{ minHeight: 48, fontSize: '.95rem' }} onClick={() => { place(h.lng, h.lat, 'buscador'); setHits(null); map.current?.flyTo([h.lng, h.lat], 16.5); }}>{h.label}</button>)}
          </div>
        ) : <div className="small muted">Sin resultados. Ubique el lugar tocando el mapa.</div>)}
        {loc.lng == null && <div><button type="button" className="btn sm ghost" onClick={() => session.answer('C3_estado', 'omitido', { item, path: (s) => destOf(s, id) })}>{destOf(state, id).C3_estado === 'omitido' ? 'Marcado sin ubicación' : 'No sabe dónde queda'}</button></div>}
        {loc.lng != null && <div className="small" style={{ color: 'var(--solo)', fontWeight: 700 }}>Lugar marcado. Puede tocar de nuevo para corregirlo.</div>}
      </div>
    </MapCanvas>
  );
}

export function DestListaStep({ session, state, goTo, next }: StepProps) {
  const dests: any[] = state.answers.destinos;
  const c5 = optionsOf(ITEMS.C5);
  const add = () => {
    const id = uid();
    session.update((s) => { s.answers.destinos.push({ id }); s.geo.destinos[id] = {}; delete s.answers.C_sin_destinos; });
    session.event('dest_add', 'C.lista', { n: dests.length });
    setTimeout(() => goTo(`C.${id}.C1`), 0);
  };
  const remove = (id: string) => {
    if (!confirm('¿Borrar este lugar y todo lo registrado sobre él?')) return;
    session.update((s) => {
      s.answers.destinos = s.answers.destinos.filter((d: any) => d.id !== id);
      delete s.geo.destinos[id]; delete s.geo.rutas[id];
      for (const k of ['C7', 'C8', 'C9']) delete s.answers[k];
    });
    session.event('dest_delete', 'C.lista');
  };
  return (
    <div className="question">
      <div className="qid">Bloque C, lugares que visita habitualmente caminando</div>
      <div className="qtext">{dests.length === 0 ? 'Partamos por el lugar que visita más seguido.' : dests.length < 5 ? '¿Hay otro lugar al que vaya habitualmente caminando?' : 'Ya están los cinco lugares.'}</div>
      {dests.length > 0 && (
        <div className="rank">
          {dests.map((d, i) => (
            <div key={d.id} className="rankcard set">
              <span className="n">{i + 1}</span>
              <span className="grow"><b>{state.geo.destinos[d.id]?.nombre || 'Sin nombre'}</b>
                <span className="hint small muted" style={{ display: 'block' }}>{T(state, c5.find((o) => o.code === d.C5)?.label ?? 'Faltan respuestas')}</span></span>
              <button type="button" className="btn sm" onClick={() => goTo(`C.${d.id}.C1`)}>Revisar</button>
              <button type="button" className="btn sm" aria-label="Borrar lugar" onClick={() => remove(d.id)}>Borrar</button>
            </div>
          ))}
        </div>
      )}
      <div className="row wrap">
        {dests.length < 5 && <button type="button" className="btn primary" onClick={add}>{dests.length === 0 ? 'Agregar el primer lugar' : 'Agregar otro lugar'}</button>}
        {dests.length > 0 && <button type="button" className="btn" onClick={next}>No hay más lugares</button>}
        {dests.length === 0 && <button type="button" className="btn" aria-pressed={state.answers.C_sin_destinos === true} onClick={() => { session.answer('C_sin_destinos', true, { item: 'C.lista' }); setTimeout(next, 200); }}>No va caminando a ningún lugar</button>}
      </div>
    </div>
  );
}

const ORDEN: Record<string, { q: string; hint: string; first: string; last: string }> = {
  C7: { q: 'De los lugares a los que [NOMBRE] va {solo|sola|sin compañía}, ¿a cuál aprendió a ir primero, a cuál después y a cuál al final?', hint: 'Toque los lugares en orden, partiendo por el que aprendió primero.', first: 'Primero', last: 'Al final' },
  C8: { q: 'De esos mismos lugares, ¿a cuál le resulta más fácil llegar, a cuál le sigue y a cuál le resulta más difícil?', hint: 'Toque los lugares en orden, partiendo por el más fácil.', first: 'Más fácil', last: 'Más difícil' },
  C9: { q: 'Y de esos lugares, ¿cuál es más importante para su vida diaria, cuál le sigue y cuál es menos importante?', hint: 'Toque los lugares en orden, partiendo por el más importante.', first: 'Más importante', last: 'Menos importante' },
};

export function OrdenStep({ session, state, step }: StepProps) {
  const key = step.id;
  const solos = soloDests(state.answers);
  const order: string[] = (state.answers[key] ?? []).filter((id: string) => solos.some((d) => d.id === id));
  const o = ORDEN[key];
  const tap = (id: string) => {
    const next = order.includes(id) ? order.filter((x) => x !== id) : [...order, id];
    // con un solo lugar pendiente, se completa automáticamente
    const rest = solos.filter((d) => !next.includes(d.id));
    session.answer(key, rest.length === 1 && next.length === solos.length - 1 && !order.includes(id) ? [...next, rest[0].id] : next, { item: key });
  };
  return (
    <div className="question">
      <div className="qid">{key}</div>
      <div className="qtext">{T(state, o.q)}</div>
      <div className="qhelp">{o.hint}</div>
      <div className="rank">
        {solos.map((d) => {
          const pos = order.indexOf(d.id);
          return (
            <button key={d.id} type="button" className={'rankcard' + (pos >= 0 ? ' set' : '')} onClick={() => tap(d.id)}>
              <span className="n">{pos >= 0 ? pos + 1 : ''}</span>
              <span className="grow">{state.geo.destinos[d.id]?.nombre}</span>
              {pos === 0 && <span className="tag con">{o.first}</span>}
              {pos === solos.length - 1 && pos > 0 && <span className="tag con">{o.last}</span>}
            </button>
          );
        })}
      </div>
      <div><button type="button" className="btn sm" disabled={!order.length} onClick={() => session.answer(key, [], { item: key })}>Empezar de nuevo</button></div>
    </div>
  );
}

export function RutaStep({ session, state, step, token }: StepProps) {
  const id = step.dest!;
  const item = step.id;
  const map = useRef<MapHandle>(null);
  const [tool, setTool] = useState<Tool>(null);
  const home = homeOf(state)!;
  const d = destOf(state, id);
  const loc = state.geo.destinos[id] ?? {};
  const log = useMemo(() => mapLog(session, item), [session, item]);
  const dl = useDrawLog(session, item, map);
  const route = state.geo.rutas[id]?.geometry;
  const features = useMemo(() => (route ? [feat(route, 'ruta')] : []), [route]);
  useEffect(() => {
    if (loc.lng == null) return;
    const b = bounds([home, [loc.lng, loc.lat]]);
    const t = setTimeout(() => b && map.current?.fit(b), 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const markers: Marker[] = [{ id: 'home', kind: 'home', lng: home[0], lat: home[1] }, ...(loc.lng != null ? [{ id, kind: 'dest' as const, lng: loc.lng, lat: loc.lat, label: String(destIndex(state, id)) }] : [])];
  const setD = (k: string, v: any) => session.answer(k, v, { item, path: (s) => destOf(s, id) });

  return (
    <MapCanvas ref={map} token={token} center={home} tool={tool} features={features} markers={markers} {...log} onDrawStart={dl.start}
      onTooShort={() => session.event('draw_short', item)}
      onDrawn={(r) => {
        session.update((s) => { s.geo.rutas[id] = { geometry: r.geometry, trazo: r.trazo ?? null }; destOf(s, id).C10_estado = 'trazada'; });
        dl.end(r, { longitud_m: Math.round(lineLength(r.geometry.coordinates)) });
        setTool(null);
      }}>
      {!tool && (
        <div className="mapcard stack" style={{ gap: 12 }}>
          <div><b className="t">C10, camino a {loc.nombre}</b>{T(state, CONSIGNA.C10)}</div>
          {d.C10_estado === 'trazada' && (
            <div>
              <div className="lbl">¿Usa más de un camino para llegar?</div>
              <Choices cols2 options={INSTRUMENT.scales.sino} value={d.C10_alt} onChange={(v) => setD('C10_alt', v)} />
            </div>
          )}
        </div>
      )}
      {tool && <div className="drawhint">Dibuje el camino con el dedo, desde la casa hasta el lugar</div>}
      <div className="mapactions">
        {!tool && <button type="button" className={'btn' + (route ? '' : ' primary')} onClick={() => { if (route) session.event('draw_redo', item); setTool('linea-libre'); }}>{route ? 'Volver a trazar' : 'Trazar el camino'}</button>}
        {!tool && !route && <button type="button" className="btn sm ghost" style={{ background: '#fff' }} onClick={() => setD('C10_estado', 'omitida')}>{d.C10_estado === 'omitida' ? 'Marcado sin respuesta' : 'Sin respuesta'}</button>}
        {tool && <button type="button" className="btn" onClick={() => setTool(null)}>Cancelar</button>}
      </div>
    </MapCanvas>
  );
}
