import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { MapCanvas, SANTIAGO } from '../components/MapCanvas';
import { fmtDate, Modal } from '../components/ui';
import { api, getSession } from '../lib/api';
import { useConfig } from '../lib/config';
import { ITEMS, optionsOf, tx } from '../lib/instrument';

const ST: Record<string, [string, string]> = { en_curso: ['En curso', 'warn'], completada: ['Completada', 'ok'], terminada_filtro: ['Filtro', ''], interrumpida: ['Interrumpida', 'bad'] };

async function download(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true, timeout: 180000 });
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function useApi<T>(path: string, deps: any[] = []): [T | null, () => void, string | null] {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => { let on = true; api<T>(path).then((d) => on && (setData(d), setErr(null))).catch((e) => on && setErr(e.message)); return () => { on = false; }; }, [path, n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, () => setN((x) => x + 1), err];
}

export default function Admin() {
  return (
    <>
      <div className="navbar">
        <span className="brand">Encuesta de Díadas, administración</span>
        <nav className="tabs">
          <NavLink to="/admin" end>Síntesis</NavLink>
          <NavLink to="/admin/encuestas">Encuestas</NavLink>
          <NavLink to="/admin/encuestadores">Encuestadores</NavLink>
          <NavLink to="/admin/configuracion">Configuración</NavLink>
        </nav>
        <span className="grow" />
        <span className="small muted">{getSession()?.email}</span>
        <Link className="btn sm" to="/">Ir a aplicar encuestas</Link>
      </div>
      <Routes>
        <Route index element={<Summary />} />
        <Route path="encuestas" element={<Surveys />} />
        <Route path="encuestadores" element={<Interviewers />} />
        <Route path="configuracion" element={<Config />} />
      </Routes>
    </>
  );
}

function Bars({ d }: { d: any }) {
  const max = Math.max(1, ...d.categorias.map((c: any) => c.n));
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b>{d.titulo}</b>{d.sin_dato > 0 && <span className="small muted">{d.sin_dato} sin dato</span>}</div>
      <div className="bars">
        {d.categorias.map((c: any) => (
          <div key={String(c.code)} className={'bar' + (c.n === 0 ? ' zero' : '')}>
            <span>{c.label}</span><span className="track"><span className="fill" style={{ width: `${(c.n / max) * 100}%`, display: 'block' }} /></span><span className="n">{c.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const D5 = ['#c2412d', '#e0a08f', '#c9d2ce', '#8fcabd', '#0e7c6b'];

function Summary() {
  const [s, reload, err] = useApi<any>('/admin/summary');
  const [exp, setExp] = useState({ include_tests: false, include_excluded: false, only_completed: true });
  const [busy, setBusy] = useState(false);
  if (err) return <div className="page"><div className="notice bad">{err}</div></div>;
  if (!s) return <div className="page">Cargando</div>;
  const c = s.counts;
  const maxCom = Math.max(1, ...s.por_comuna.map((x: any) => x.validas + x.en_curso));
  const alertas = s.indicadores.filter((i: any) => i.alerta);
  return (
    <div className="page">
      <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 1.2fr) 2fr' }}>
        <div className="card stack">
          <div className="muted">Díadas válidas completadas</div>
          <div><span className="bignum">{c.validas}</span><span className="muted" style={{ fontSize: '1.4rem' }}> de {c.objetivo}</span></div>
          <div className="meter"><i style={{ width: `${Math.min(100, (c.validas / c.objetivo) * 100)}%` }} /></div>
          <div className="muted small">Faltan {Math.max(0, c.objetivo - c.validas)} para la muestra objetivo.</div>
        </div>
        <div className="card">
          <dl className="kv">
            <dt>En curso</dt><dd>{c.en_curso}</dd>
            <dt>Interrumpidas</dt><dd>{c.interrumpidas}</dd>
            <dt>Cerradas en el filtro</dt><dd>{c.filtro}</dd>
            <dt>De prueba</dt><dd>{c.pruebas}</dd>
            <dt>Excluidas de la muestra</dt><dd>{c.excluidas}</dd>
            <dt>Mediana del área B1</dt><dd>{s.b1.mediana_ha != null ? `${s.b1.mediana_ha} hectáreas (${s.b1.n} polígonos)` : 'sin datos'}</dd>
            <dt>Por encuestador</dt><dd>{s.encuestadores.map((e: any) => `${e.nombre}: ${e.n}`).join(', ') || 'sin datos'}</dd>
          </dl>
        </div>
      </div>

      {(!s.sistema.correo_configurado || !s.sistema.mapbox_configurado || s.sistema.correos_fallidos > 0) && (
        <div className="notice bad">
          {!s.sistema.correo_configurado && <div>El envío de correos no está configurado (falta RESEND_API_KEY). Las encuestas se guardan igual, pero no llegan los avisos.</div>}
          {!s.sistema.mapbox_configurado && <div>Falta MAPBOX_TOKEN: los mapas no van a cargar.</div>}
          {s.sistema.correos_fallidos > 0 && <div>{s.sistema.correos_fallidos} correos no se pudieron enviar. Último error: {s.sistema.ultimo_correo?.error ?? 'sin detalle'}</div>}
        </div>
      )}

      <div className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}><h2>Por comuna</h2><span className="small muted">Verde: completadas. Ámbar: en curso.</span></div>
        {s.por_comuna.length === 0 ? <div className="muted">Todavía no hay encuestas con comuna registrada.</div> : (
          <div className="bars" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', columnGap: 32 }}>
            {s.por_comuna.map((x: any) => (
              <div key={x.comuna} className="bar"><span>{x.comuna}</span>
                <span className="track" style={{ display: 'flex' }}><span className="fill" style={{ width: `${(x.validas / maxCom) * 100}%`, minWidth: x.validas ? 2 : 0 }} /><span style={{ width: `${(x.en_curso / maxCom) * 100}%`, background: 'var(--ambar)', height: '100%' }} /></span>
                <span className="n">{x.validas}</span></div>
            ))}
          </div>
        )}
      </div>

      <h2>Perfil de las personas con síndrome de Down</h2>
      <p className="muted" style={{ marginTop: -14 }}>Las categorías en rojo todavía no tienen ningún caso.</p>
      <div className="grid g3">{s.persona.map((d: any) => <Bars key={d.id} d={d} />)}</div>
      <h2>Perfil de los cuidadores y hogares</h2>
      <div className="grid g3">{s.cuidador.map((d: any) => <Bars key={d.id} d={d} />)}</div>
      <h2>Movilidad y aplicación</h2>
      <div className="grid g3">{s.movilidad.map((d: any) => <Bars key={d.id} d={d} />)}</div>

      <h2>Criterios del piloto</h2>
      <div className="grid g2">
        <div className="card stack">
          <b>Duración de los bloques del cuidador</b>
          <div><span className="bignum" style={{ fontSize: '2.4rem', color: s.duraciones.cuidador_mediana > 40 ? 'var(--alerta)' : undefined }}>{s.duraciones.cuidador_mediana ?? 'sin datos'}</span>{s.duraciones.cuidador_mediana != null && <span className="muted"> minutos de mediana (máximo previsto: 40)</span>}</div>
          {s.duraciones.cuidador_sobre_40 > 0 && <div className="notice">{s.duraciones.cuidador_sobre_40} aplicaciones superaron los 40 minutos (máximo observado: {s.duraciones.cuidador_max}). Candidatas a salir: C10, B3, C8 y C9.</div>}
          <table className="t"><thead><tr><th>Bloque</th><th>Previsto</th><th>Mediana</th></tr></thead>
            <tbody>{s.duraciones.bloques.map((b: any) => <tr key={b.id}><td><b>{b.id}</b> {b.titulo}</td><td>{b.previsto} min</td><td style={{ fontWeight: 700, color: b.mediana > b.previsto * 1.25 ? 'var(--alerta)' : undefined }}>{b.mediana != null ? `${b.mediana} min` : ''}</td></tr>)}</tbody></table>
        </div>
        <div className="card stack">
          <b>Indicadores de las latentes E* y F*</b>
          <div className="muted small">Un indicador con más del 60% de las respuestas en una sola categoría se reemplaza por el ítem de reserva del mismo sentido.{alertas.length ? ` En alerta: ${alertas.map((a: any) => a.item).join(', ')}.` : ''}</div>
          <table className="t"><thead><tr><th>Ítem</th><th>Sentido</th><th>Distribución (1 a 5)</th><th>Máx.</th></tr></thead>
            <tbody>{s.indicadores.map((i: any) => (
              <tr key={i.item} title={i.texto}>
                <td><b>{i.item}</b>{i.reserva && <span className="small muted"> reserva</span>}</td><td>{i.sentido > 0 ? '+' : '−'}</td>
                <td><div className="dist5">{i.dist.map((n: number, k: number) => <i key={k} style={{ width: `${i.n ? (n / i.n) * 100 : 0}%`, background: D5[k] }} />)}</div><span className="small muted">n = {i.n}{i.no_sabe ? `, ${i.no_sabe} no sabe` : ''}</span></td>
                <td>{i.max_share != null ? <span className={'tag ' + (i.alerta ? 'bad' : '')}>{Math.round(i.max_share * 100)}%</span> : ''}</td>
              </tr>))}</tbody></table>
        </div>
      </div>

      <div className="card stack">
        <h2>Exportar los datos</h2>
        <p className="muted">Un archivo comprimido con una fila por díada (CSV y JSON), los destinos, los tiempos por ítem, la bitácora completa, el diccionario de variables y las capas GeoJSON. Contiene datos sensibles.</p>
        <div className="row wrap">
          {([['only_completed', 'Solo completadas'], ['include_tests', 'Incluir las de prueba'], ['include_excluded', 'Incluir las excluidas']] as const).map(([k, l]) => (
            <label key={k} className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 22, height: 22 }} checked={(exp as any)[k]} onChange={(e) => setExp({ ...exp, [k]: e.target.checked })} />{l}</label>
          ))}
        </div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); try { await download(`/admin/export?${new URLSearchParams(Object.entries(exp).map(([k, v]) => [k, String(v)]))}`, 'encuesta_diadas.zip'); } catch (e: any) { alert(e.message); } finally { setBusy(false); } }}>{busy ? 'Preparando' : 'Descargar los datos'}</button>
          <button className="btn" onClick={reload}>Actualizar la síntesis</button></div>
      </div>
    </div>
  );
}

function Surveys() {
  const [data, reload, err] = useApi<any>('/admin/surveys');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState('todas');
  const rows = (data?.surveys ?? []).filter((r: any) => filter === 'todas' || (filter === 'validas' ? r.status === 'completada' && !r.is_test && !r.excluded : filter === 'pruebas' ? r.is_test : r.status === filter));
  const g2 = optionsOf(ITEMS.G2);
  return (
    <div className="page">
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <h1>Encuestas</h1>
        <select className="field" style={{ width: 260 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="todas">Todas</option><option value="validas">Válidas completadas</option><option value="en_curso">En curso</option>
          <option value="interrumpida">Interrumpidas</option><option value="terminada_filtro">Cerradas en el filtro</option><option value="pruebas">De prueba</option>
        </select>
      </div>
      {err && <div className="notice bad">{err}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="t">
          <thead><tr><th>Código</th><th>Estado</th><th>Encuestador</th><th>Comuna</th><th>Persona</th><th>B1</th><th>Destinos</th><th>P</th><th>Duración</th><th>Inicio</th><th>Correos</th></tr></thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="clk" onClick={() => setOpen(r.id)}>
                <td><b>{r.codigo}</b> {r.is_test && <span className="tag warn">Prueba</span>} {r.excluded && <span className="tag bad">Excluida</span>}</td>
                <td><span className={'tag ' + ST[r.status][1]}>{ST[r.status][0]}</span></td>
                <td>{r.interviewer}</td><td>{r.comuna ?? ''}</td>
                <td>{[r.G1 > 0 ? `${r.G1} años` : null, g2.find((o) => o.code === r.G2)?.label].filter(Boolean).join(', ')}</td>
                <td>{r.B1_estado ?? ''}</td><td>{r.n_destinos}</td><td>{r.P_aplicado === 1 ? 'Sí' : r.P_aplicado === 0 ? 'No' : ''}</td>
                <td>{r.duracion_min != null ? `${r.duracion_min} min` : ''}</td><td>{fmtDate(r.started_at)}</td>
                <td>{r.email_start ? 'Inicio' : ''}{r.email_start && r.email_final ? ' y ' : ''}{r.email_final ? 'cierre' : ''}</td>
              </tr>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={11} className="muted">No hay encuestas con este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <Detail id={open} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const cfg = useConfig();
  const [d, reload, err] = useApi<any>(`/admin/surveys/${id}`);
  const [confirmDel, setConfirmDel] = useState('');
  const [audio, setAudio] = useState<Record<number, string>>({});
  const features = useMemo(() => {
    if (!d) return [];
    const g = d.geo ?? {};
    const f: any[] = [];
    if (g.B2?.geometry) f.push({ type: 'Feature', geometry: g.B2.geometry, properties: { kind: 'b2' } });
    if (g.B1?.geometry) f.push({ type: 'Feature', geometry: g.B1.geometry, properties: { kind: 'b1' } });
    for (const m of g.B3 ?? []) f.push({ type: 'Feature', geometry: m.geometry, properties: { kind: m.tipo } });
    for (const r of Object.values<any>(g.rutas ?? {})) f.push({ type: 'Feature', geometry: r.geometry, properties: { kind: 'ruta' } });
    return f;
  }, [d]);
  if (err) return <Modal onClose={onClose}><div className="notice bad">{err}</div><button className="btn" onClick={onClose}>Cerrar</button></Modal>;
  if (!d) return <Modal onClose={onClose}>Cargando</Modal>;
  const a = d.responses?.answers ?? {};
  const g = d.geo ?? {};
  const home = g.home?.lng != null ? [g.home.lng, g.home.lat] as [number, number] : null;
  const dests: any[] = a.destinos ?? [];
  const markers = [...(home ? [{ id: 'h', kind: 'home' as const, lng: home[0], lat: home[1] }] : []),
    ...dests.filter((x) => g.destinos?.[x.id]?.lng != null).map((x, i) => ({ id: x.id, kind: 'dest' as const, lng: g.destinos[x.id].lng, lat: g.destinos[x.id].lat, label: String(i + 1) }))];
  const flag = async (patch: any) => { await api(`/admin/surveys/${id}`, { method: 'PATCH', json: patch }); reload(); };
  const timings = Object.entries<any>(d.responses?.timings ?? {});
  const c5 = optionsOf(ITEMS.C5);
  return (
    <Modal wide onClose={onClose}>
      <div className="row wrap" style={{ justifyContent: 'space-between' }}>
        <h2>{d.codigo} <span className={'tag ' + ST[d.status][1]}>{ST[d.status][0]}</span> {d.is_test && <span className="tag warn">Prueba</span>} {d.excluded && <span className="tag bad">Excluida</span>}</h2>
        <button className="btn sm" onClick={onClose}>Cerrar</button>
      </div>
      <div className="grid g2">
        <dl className="kv">
          <dt>Persona</dt><dd>{g.nombre ?? ''}{a.G1 > 0 ? `, ${a.G1} años` : ''}</dd>
          <dt>Domicilio</dt><dd>{g.direccion ?? ''}</dd>
          <dt>Comuna</dt><dd>{d.comuna ?? ''}</dd>
          <dt>Encuestador</dt><dd>{d.interviewer}</dd>
          <dt>Inicio y término</dt><dd>{fmtDate(d.started_at)} a {fmtDate(d.completed_at) || 'sin terminar'}</dd>
          <dt>Duración</dt><dd>{d.duracion_min != null ? `${d.duracion_min} minutos` : ''}</dd>
          <dt>Trazabilidad</dt><dd>{d.events} eventos, {timings.length} pantallas con tiempo</dd>
          <dt>Consentimientos</dt><dd>Cuidador: {d.responses?.consent?.cuidador?.modo ?? 'sin registro'}. Persona: {d.responses?.consent?.persona?.modo ?? 'sin registro'}</dd>
          <dt>Motivo de término</dt><dd>{d.responses?.meta?.end_reason ?? ''}</dd>
        </dl>
        <div style={{ height: 320, display: 'flex', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--line)' }}>
          {cfg?.mapbox_token && home ? <MapCanvas token={cfg.mapbox_token} center={home} zoom={14.5} tool={null} features={features} markers={markers} /> : <div className="mapfail muted" style={{ position: 'static', flex: 1 }}>Sin ubicación registrada</div>}
        </div>
      </div>
      <div className="small muted">Verde: sin acompañamiento (B1) y rutas. Violeta: acompañado (B2). Rojo: preocupaciones (B3).</div>
      {dests.length > 0 && (
        <table className="t"><thead><tr><th>Destino</th><th>Régimen</th><th>Ruta</th></tr></thead>
          <tbody>{dests.map((x, i) => <tr key={x.id}><td>{i + 1}. {g.destinos?.[x.id]?.nombre}</td><td>{tx(c5.find((o) => o.code === x.C5)?.label ?? '', g.nombre, a.tratamiento)}</td><td>{g.rutas?.[x.id] ? 'Trazada' : ''}</td></tr>)}</tbody></table>
      )}
      {d.audio.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <b>Audio</b>
          {d.audio.map((s: any) => (
            <div key={s.segment} className="row wrap">
              <span>Tramo {s.segment + 1}, {(s.bytes / 1048576).toFixed(1)} MB</span>
              {audio[s.segment] ? <audio controls src={audio[s.segment]} /> : <button className="btn sm" onClick={async () => { const r = await api<Response>(`/admin/surveys/${id}/audio/${s.segment}`, { raw: true, timeout: 180000 }); const url = URL.createObjectURL(await r.blob()); setAudio((x) => ({ ...x, [s.segment]: url })); }}>Escuchar</button>}
              <button className="btn sm" onClick={() => download(`/admin/surveys/${id}/audio/${s.segment}`, `${d.codigo}_audio_${s.segment}`)}>Descargar</button>
            </div>
          ))}
        </div>
      )}
      {(d.responses?.notas ?? []).length > 0 && <div><b>Observaciones del encuestador</b>{d.responses.notas.map((n: any, i: number) => <div key={i} className="small">{n.item}: {n.texto}</div>)}</div>}
      <details><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Tiempos por pantalla</summary>
        <table className="t"><thead><tr><th>Pantalla</th><th>Segundos</th><th>Hasta la primera respuesta</th><th>Visitas</th><th>Cambios</th></tr></thead>
          <tbody>{timings.map(([k, t]) => <tr key={k}><td>{k}</td><td>{(t.ms / 1000).toFixed(1)}</td><td>{t.first_ms != null ? (t.first_ms / 1000).toFixed(1) : ''}</td><td>{t.visits}</td><td>{t.changes ?? 0}</td></tr>)}</tbody></table>
      </details>
      <details><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Registro completo (JSON)</summary><pre style={{ fontSize: 12, overflow: 'auto', maxHeight: 360, background: 'var(--bg)', padding: 12, borderRadius: 10 }}>{JSON.stringify({ ...d.responses, geo: { ...g, firmas: Object.fromEntries(Object.entries(g.firmas ?? {}).map(([k, v]) => [k, v ? '(imagen de firma)' : null])) } }, null, 1)}</pre></details>
      <div className="card stack" style={{ background: 'var(--bg)' }}>
        <div className="row wrap">
          <button className="btn sm" onClick={() => flag({ is_test: !d.is_test })}>{d.is_test ? 'Quitar la marca de prueba' : 'Marcar como prueba'}</button>
          <button className="btn sm" onClick={() => flag({ excluded: !d.excluded })}>{d.excluded ? 'Volver a incluir en la muestra' : 'Excluir de la muestra'}</button>
        </div>
        <div className="small muted">Excluir o marcar como prueba saca la encuesta de la síntesis y de la exportación, sin borrar nada. Eliminar la borra de la base de datos, con su audio y su bitácora, y no se puede deshacer.</div>
        <div className="row wrap">
          <input className="field" style={{ maxWidth: 300, minHeight: 44 }} placeholder={`Escriba ${d.codigo} para eliminar`} value={confirmDel} onChange={(e) => setConfirmDel(e.target.value)} />
          <button className="btn sm danger" disabled={confirmDel.trim().toUpperCase() !== d.codigo} onClick={async () => { await api(`/admin/surveys/${id}`, { method: 'DELETE' }); onClose(); }}>Eliminar definitivamente</button>
        </div>
      </div>
    </Modal>
  );
}

function Interviewers() {
  const [data, reload] = useApi<any>('/admin/interviewers');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [shown, setShown] = useState<{ name: string; email: string; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { const r = await api('/admin/interviewers', { json: { name, email } }); setShown(r); setName(''); setEmail(''); reload(); } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="page">
      <h1>Encuestadores</h1>
      <p className="muted" style={{ marginTop: -12 }}>Cada encuesta queda asociada a quien la aplicó. Usted también puede aplicar encuestas con su propia cuenta.</p>
      <form className="card row wrap" onSubmit={create} style={{ alignItems: 'flex-end' }}>
        <div className="grow"><label className="lbl">Nombre</label><input className="field" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="grow"><label className="lbl">Correo</label><input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <button className="btn primary">Crear encuestador</button>
      </form>
      {err && <div className="notice bad">{err}</div>}
      {shown && <div className="notice good">Clave de acceso de <b>{shown.name}</b> ({shown.email}): <b style={{ fontSize: '1.4rem', letterSpacing: '.08em' }}>{shown.code}</b><div className="small">Anótela ahora: no se vuelve a mostrar. Si se pierde, genere una nueva.</div></div>}
      <table className="t">
        <thead><tr><th>Nombre</th><th>Correo</th><th>Encuestas</th><th>Estado</th><th /></tr></thead>
        <tbody>{(data?.interviewers ?? []).map((i: any) => (
          <tr key={i.id}><td><b>{i.name}</b></td><td>{i.email}</td><td>{i.n_encuestas}</td><td><span className={'tag ' + (i.active ? 'ok' : 'bad')}>{i.active ? 'Activo' : 'Desactivado'}</span></td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <button className="btn sm" onClick={async () => { const r = await api(`/admin/interviewers/${i.id}`, { method: 'PATCH', json: { reset_code: true } }); setShown({ name: i.name, email: i.email, code: r.code }); }}>Generar clave nueva</button>{' '}
              <button className="btn sm" onClick={async () => { await api(`/admin/interviewers/${i.id}`, { method: 'PATCH', json: { active: !i.active } }); reload(); }}>{i.active ? 'Desactivar' : 'Activar'}</button>
            </td></tr>))}
          {data && data.interviewers.length === 0 && <tr><td colSpan={5} className="muted">Todavía no hay encuestadores.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Config() {
  const [remote] = useApi<any>('/admin/settings');
  const [audit] = useApi<any>('/admin/audit');
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (remote) setS(remote); }, [remote]);
  if (!s) return <div className="page">Cargando</div>;
  const save = async () => { setS(await api('/admin/settings', { method: 'PUT', json: s })); setMsg('Configuración guardada. Los tablets la reciben la próxima vez que abran la aplicación con conexión.'); };
  const Check = ({ label, checked, onChange }: any) => <label className="row" style={{ gap: 10 }}><input type="checkbox" style={{ width: 24, height: 24 }} checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <h1>Configuración del estudio</h1>
      <div className="card stack">
        <h2>Instrumento</h2>
        <div><label className="lbl">Fase</label>
          <select className="field" style={{ maxWidth: 320 }} value={s.fase} onChange={(e) => setS({ ...s, fase: e.target.value })}><option value="piloto">Piloto</option><option value="levantamiento">Levantamiento</option></select></div>
        <Check label="Aplicar los ítems de reserva (E5, E6, F6 y F7)" checked={s.incluir_reserva} onChange={(v: boolean) => setS({ ...s, incluir_reserva: v })} />
        <div className="lbl" style={{ marginBottom: -6 }}>Tareas candidatas a salir si el piloto supera los 40 minutos</div>
        {([['B3', 'B3, mapa de preocupaciones'], ['C8', 'C8, orden de facilidad'], ['C9', 'C9, orden de importancia'], ['C10', 'C10, trazado de rutas']] as const).map(([k, l]) => (
          <Check key={k} label={l} checked={s.tareas[k]} onChange={(v: boolean) => setS({ ...s, tareas: { ...s.tareas, [k]: v } })} />
        ))}
        <div className="small muted">Cada encuesta guarda la configuración con la que se aplicó.</div>
      </div>
      <div className="card stack">
        <h2>Consentimiento informado</h2>
        <label className="lbl">Texto para el cuidador</label>
        <textarea className="field" style={{ minHeight: 260, fontSize: '1rem' }} value={s.consentimiento_cuidador} onChange={(e) => setS({ ...s, consentimiento_cuidador: e.target.value })} />
        <label className="lbl">Documento en lectura fácil para la persona (una frase por pictograma)</label>
        {s.consentimiento_persona.map((r: any, i: number) => (
          <div key={i} className="row"><img src={`/pictos/${r.picto}.png`} alt="" width={48} height={48} /><input className="field" style={{ minHeight: 48, fontSize: '1rem' }} value={r.texto} onChange={(e) => setS({ ...s, consentimiento_persona: s.consentimiento_persona.map((x: any, k: number) => (k === i ? { ...x, texto: e.target.value } : x)) })} /></div>
        ))}
        <Check label="Estos textos son los aprobados por el Comité Ético Científico" checked={s.consentimiento_aprobado} onChange={(v: boolean) => setS({ ...s, consentimiento_aprobado: v })} />
      </div>
      <div className="row"><button className="btn primary" onClick={save}>Guardar la configuración</button>
        <button className="btn" onClick={async () => { try { const r = await api('/admin/test-email', { method: 'POST' }); setMsg(`Correo de prueba enviado a ${r.to}.`); } catch (e: any) { setMsg(e.message); } }}>Enviar un correo de prueba</button></div>
      {msg && <div className="notice info">{msg}</div>}
      <details className="card"><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Registro de acciones de administración</summary>
        <table className="t"><tbody>{(audit?.audit ?? []).map((r: any, i: number) => <tr key={i}><td>{fmtDate(r.t)}</td><td>{r.action}</td><td className="small">{JSON.stringify(r.detail)}</td></tr>)}</tbody></table>
      </details>
    </div>
  );
}
