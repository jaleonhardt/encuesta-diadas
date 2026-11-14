import { useState } from 'react';
import { Choices, MultiChoices, Picto, SignaturePad, TextInput } from '../components/ui';
import { MapCanvas, SANTIAGO, type MapHandle } from '../components/MapCanvas';
import { COMUNAS, INSTRUMENT, ITEMS, NR, matchComuna, optionsOf } from '../lib/instrument';
import { useRef } from 'react';
import { mapLog, T, type StepProps } from './common';

/** Ítem cerrado genérico (opción única, múltiple o numérico), definido en shared/instrument.json. */
export function ItemStep({ session, state, step, next }: StepProps) {
  const it = ITEMS[step.item!];
  const dest = step.dest ? state.answers.destinos.find((d: any) => d.id === step.dest) : null;
  const target = dest ?? state.answers;
  const path = dest ? (s: any) => s.answers.destinos.find((d: any) => d.id === step.dest) : undefined;
  const value = target[step.item!];
  const set = (v: any) => session.answer(step.item!, v, { item: step.id, path });
  const destName = dest ? state.geo.destinos[dest.id]?.nombre : null;
  const opts = it.type !== 'number' ? optionsOf(it).map((o) => ({ ...o, label: T(state, o.label) })) : [];
  const likert = it.scale === 'likert5' || it.scale === 'licencia5';
  const otherKey = step.item + '_otro';
  const showOther = it.otherCode !== undefined && (it.type === 'multi' ? (value ?? []).includes?.(it.otherCode) : value === it.otherCode);

  return (
    <div className="question">
      <div className="qid">{step.item === 'H11r' ? 'H11, razones' : step.item}{destName ? `, ${destName}` : ''}{it.reserve ? ', ítem de reserva' : ''}</div>
      <div className="qtext">{T(state, it.text)}</div>
      {it.help && <div className="qhelp">{T(state, it.help)}</div>}
      {it.type === 'single' && (
        <Choices options={opts} value={value} scale5={likert} cols2={!likert && opts.length > 6}
          onChange={(v) => { set(v); if (v !== it.otherCode) setTimeout(next, 260); }} />
      )}
      {it.type === 'multi' && (
        <>
          <div className="muted">Puede marcar más de una.</div>
          <MultiChoices options={opts} value={Array.isArray(value) ? value : []} exclusive={it.exclusiveCode} onChange={set} />
        </>
      )}
      {it.type === 'number' && (
        <div className="row">
          <input className="field" style={{ maxWidth: 200, fontSize: '1.8rem', textAlign: 'center' }} type="number" inputMode="numeric" min={it.min} max={it.max}
            value={typeof value === 'number' && value >= 0 ? value : ''} autoFocus
            onChange={(e) => { const n = e.target.value === '' ? undefined : Number(e.target.value); if (n === undefined || (Number.isFinite(n) && n >= 0 && n <= (it.max ?? 999))) set(n); }}
            onKeyDown={(e) => { if (e.key === 'Enter') next(); }} />
          <span className="qhelp">{it.unit}</span>
        </div>
      )}
      {it.type === 'number' && typeof value === 'number' && value >= 0 && it.min !== undefined && value < it.min && (
        <div className="notice">El valor ingresado es menor que {it.min}. Revise antes de continuar.</div>
      )}
      {showOther && (
        <div>
          <label className="lbl" htmlFor="otro">¿Cuál?</label>
          <TextInput id="otro" value={target[otherKey] ?? ''} autoFocus onCommit={(v) => session.answer(otherKey, v, { item: step.id, path, logValue: false })} />
        </div>
      )}
      {!(it.type === 'single' && opts.some((o) => o.code === NR)) && (
        <div><button type="button" className="btn ghost sm" aria-pressed={value === NR} onClick={() => { set(it.type === 'multi' ? [NR] : NR); setTimeout(next, 200); }}>
          {value === NR || (Array.isArray(value) && value[0] === NR) ? 'Marcado sin respuesta' : 'Sin respuesta'}
        </button></div>
      )}
    </div>
  );
}

const INTROS: Record<string, { titulo: string; quien?: string; extra?: string }> = {
  'B.intro': { titulo: 'Ahora vamos a trabajar sobre un mapa.', extra: 'El mapa está centrado en la casa. Se puede mover con un dedo y acercar con dos. Para dibujar, toque el botón «Dibujar el área» y trace el borde con el dedo, sin levantarlo.', quien: 'Acerque el tablet al cuidador: las siguientes tareas las dibuja directamente.' },
  'C.intro': { titulo: INSTRUMENT.consignas.C },
  'D.intro': { titulo: INSTRUMENT.consignas.D },
  'E.intro': { titulo: INSTRUMENT.consignas.E },
  'F.intro': { titulo: INSTRUMENT.consignas.F },
  'P.intro': { titulo: INSTRUMENT.consignas.P, quien: 'Lea la consigna a la persona y luego entréguele el tablet.' },
};

export function IntroStep({ state, step }: StepProps) {
  const i = INTROS[step.id];
  return (
    <div className="question">
      <div className="qid">Consigna para leer en voz alta</div>
      <div className="consigna">{T(state, i.titulo)}</div>
      {i.extra && <div className="qhelp">{i.extra}</div>}
      {i.quien && <div className="notice info">{i.quien}</div>}
    </div>
  );
}

export function ConsentCuidadorStep({ session, state, settings }: StepProps) {
  const c = state.consent.cuidador ?? {};
  const set = (patch: any) => {
    session.update((s) => { s.consent.cuidador = { ...(s.consent.cuidador ?? {}), ...patch, ts: new Date().toISOString() }; });
    session.event('consent', 'consentimiento.cuidador', patch);
  };
  return (
    <div className="question">
      <div className="qid">Consentimiento informado del cuidador</div>
      <div className="qtext">¿Cómo se firma el consentimiento?</div>
      <Choices cols2 value={c.modo === 'papel' ? 1 : c.modo === 'app' ? 2 : undefined} onChange={(v) => set({ modo: v === 1 ? 'papel' : 'app' })}
        options={[{ code: 1, label: 'Ya está firmado en papel' }, { code: 2, label: 'Se firma aquí, en el tablet' }]} />
      {c.modo === 'app' && (
        <div className="card stack">
          {!settings?.consentimiento_aprobado && <div className="notice">Texto en borrador. El texto aprobado por el Comité Ético Científico se carga desde el portal de administración.</div>}
          <div style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', fontSize: '1.05rem' }}>{settings?.consentimiento_cuidador}</div>
        </div>
      )}
      {c.modo && (
        <>
          <div>
            <div className="lbl">¿Acepta participar en el estudio?</div>
            <Choices cols2 value={c.acepta === true ? 1 : c.acepta === false ? 0 : undefined} onChange={(v) => set({ acepta: v === 1 })} options={INSTRUMENT.scales.sino} />
          </div>
          {c.acepta === true && (
            <div>
              <div className="lbl">¿Autoriza que se grabe el audio de la entrevista?</div>
              <Choices cols2 value={c.audio === true ? 1 : c.audio === false ? 0 : undefined} onChange={(v) => set({ audio: v === 1 })} options={INSTRUMENT.scales.sino} />
              <div className="muted small" style={{ marginTop: 6 }}>Si no autoriza, la encuesta se aplica igual, sin grabación.</div>
            </div>
          )}
          {c.acepta === true && c.modo === 'app' && (
            <div>
              <div className="lbl">Firma del cuidador</div>
              <SignaturePad value={state.geo.firmas?.cuidador} onChange={(d) => session.update((s) => { s.geo.firmas.cuidador = d; })} />
            </div>
          )}
          {c.acepta === false && <div className="notice">Sin consentimiento no se aplica la encuesta. Al continuar, se cierra y queda registrada como no realizada.</div>}
        </>
      )}
    </div>
  );
}

export function A2Step({ session, state }: StepProps) {
  return (
    <div className="question">
      <div className="qid">A2</div>
      <div className="qtext">¿Cómo se llama esta persona, o cómo le dicen habitualmente?</div>
      <TextInput value={state.geo.nombre ?? ''} autoFocus placeholder="Nombre o apodo" onCommit={(v) => { session.update((s) => { s.geo.nombre = v.trim(); }); session.event('answer', 'A2', { key: 'nombre' }); }} />
      <div>
        <div className="lbl">Las preguntas se van a redactar hablando de</div>
        <Choices cols2 value={state.answers.tratamiento === 'f' ? 1 : state.answers.tratamiento === 'm' ? 2 : undefined}
          onChange={(v) => session.answer('tratamiento', v === 1 ? 'f' : 'm', { item: 'A2' })}
          options={[{ code: 1, label: 'Ella', hint: 'va sola, la acompañan' }, { code: 2, label: 'Él', hint: 'va solo, lo acompañan' }]} />
        <div className="muted small" style={{ marginTop: 6 }}>Esto solo adapta la redacción. El género se pregunta en G2.</div>
      </div>
    </div>
  );
}

type Hit = { label: string; lng: number; lat: number; names: (string | undefined)[]; accuracy?: string };

async function geocode(q: string, token: string): Promise<Hit[]> {
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&country=cl&language=es&limit=6&proximity=${SANTIAGO.join(',')}&bbox=-71.2,-33.95,-70.25,-33.05&access_token=${token}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('El buscador de direcciones respondió ' + r.status);
  const j = await r.json();
  return (j.features ?? []).map((f: any) => {
    const ctx = f.properties?.context ?? {};
    return { label: f.properties?.full_address ?? f.properties?.name ?? q, lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      names: [ctx.locality?.name, ctx.place?.name, ctx.district?.name, ctx.neighborhood?.name], accuracy: f.properties?.coordinates?.accuracy ?? f.properties?.feature_type };
  });
}

export function A4Step({ session, state, token }: StepProps) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const map = useRef<MapHandle>(null);
  const home = state.geo.home;
  const log = mapLog(session, 'A4');

  const search = async () => {
    const q = (state.geo.direccion ?? '').trim();
    if (q.length < 4) return;
    setBusy(true); setErr(null);
    const t0 = performance.now();
    try {
      const res = await geocode(q, token);
      setHits(res);
      session.event('geocode', 'A4', { resultados: res.length, ms: Math.round(performance.now() - t0) });
      if (!res.length) setErr('No se encontró la dirección. Revise cómo está escrita o ubique la casa directamente en el mapa.');
    } catch (e: any) {
      setErr(navigator.onLine ? e.message : 'Sin conexión: no se puede buscar la dirección. Puede ubicar la casa directamente en el mapa.');
      session.event('geocode_error', 'A4', { online: navigator.onLine });
    } finally { setBusy(false); }
  };
  const pick = (h: Hit) => {
    const comuna = matchComuna(h.names);
    session.update((s) => {
      s.geo.home = { lng: h.lng, lat: h.lat, fuente: 'geocodificador', place_name: h.label, precision: h.accuracy };
      if (comuna) { s.answers.comuna = comuna; s.answers.comuna_fuente = 'geocodificador'; }
    });
    session.event('answer', 'A4', { key: 'home', fuente: 'geocodificador' });
    setHits(null);
    setTimeout(() => map.current?.flyTo([h.lng, h.lat], 16.5), 100);
  };

  return (
    <div className="question" style={{ maxWidth: 980 }}>
      <div className="qid">A4</div>
      <div className="qtext">¿Cuál es la dirección del domicilio de {state.geo.nombre || 'la persona'}?</div>
      <div className="row">
        <div className="grow"><TextInput value={state.geo.direccion ?? ''} placeholder="Calle, número y comuna" onCommit={(v) => { session.update((s) => { s.geo.direccion = v; }); session.event('answer', 'A4', { key: 'direccion' }); }} /></div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => setTimeout(search, 80)}>{busy ? 'Buscando' : 'Buscar'}</button>
      </div>
      {err && <div className="notice">{err}</div>}
      {hits && hits.length > 0 && (
        <div className="choices">
          {hits.map((h, i) => <button key={i} type="button" className="choice" onClick={() => pick(h)}><span>{h.label}</span></button>)}
        </div>
      )}
      {!home && !manual && <div><button type="button" className="btn sm" onClick={() => setManual(true)}>Ubicar la casa directamente en el mapa</button></div>}
      {(home || manual) && (
        <>
          <div className="notice info">{home ? 'Confirme con el cuidador que la casa está bien ubicada. Si no, toque el mapa en el lugar correcto.' : 'Mueva el mapa y toque el lugar donde está la casa.'}</div>
          <div style={{ height: 380, display: 'flex', borderRadius: 18, overflow: 'hidden', border: '1px solid var(--line)' }}>
            <MapCanvas ref={map} token={token} center={home ? [home.lng, home.lat] : SANTIAGO} zoom={home ? 16.5 : 11.5} tool="punto" {...log}
              markers={home ? [{ id: 'home', kind: 'home', lng: home.lng, lat: home.lat }] : []}
              onDrawn={(r) => {
                const [lng, lat] = r.geometry.coordinates;
                session.update((s) => { s.geo.home = { ...(s.geo.home ?? {}), lng, lat, fuente: s.geo.home?.fuente?.startsWith('geocodificador') ? 'geocodificador_ajustado' : 'manual' }; });
                session.event('answer', 'A4', { key: 'home', fuente: 'toque' });
              }} />
          </div>
          <div>
            <label className="lbl" htmlFor="comuna">Comuna</label>
            <select id="comuna" className="field" value={state.answers.comuna ?? ''} onChange={(e) => { session.answer('comuna', e.target.value, { item: 'A4' }); session.update((s) => { s.answers.comuna_fuente = 'encuestador'; }); }}>
              <option value="">Seleccione la comuna</option>
              {COMUNAS.map((c) => <option key={c}>{c}</option>)}
              <option>Otra</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}

export function EasyRow({ picto, texto }: { picto: number; texto: string }) {
  return <div className="easy"><Picto id={picto} alt="" /><div>{texto}</div></div>;
}
