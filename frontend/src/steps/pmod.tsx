import { useEffect, useMemo, useRef, useState } from 'react';
import { Choices, Picto, PICTO_CREDIT, SignaturePad, TextInput } from '../components/ui';
import { INSTRUMENT, ITEMS, NR, PMOD, optionsOf, tx } from '../lib/instrument';
import { EasyRow } from './basic';
import { T, tratDe, type StepProps } from './common';

const setP = (session: StepProps['session'], item: string, patch: any, log = true) => {
  session.update((s) => { Object.assign((s.answers.P ??= {}), patch); const t = (s.timings[item] ??= { ms: 0, visits: 0, changes: 0 }); if (t.first_ms === undefined) t.first_ms = t.ms; });
  if (log) session.event('answer', item, patch);
};

export function PAplicaStep({ session, state }: StepProps) {
  const p = state.answers.P ?? {};
  const g3 = optionsOf(ITEMS.G3).find((o) => o.code === state.answers.G3)?.label;
  return (
    <div className="question">
      <div className="qid">Módulo P, para el encuestador</div>
      <div className="qtext">{T(state, '¿Se aplica el módulo de tarjetas a [NOMBRE]?')}</div>
      <div className="qhelp">El módulo lo responde la propia persona, en lo posible en un espacio separado del cuidador. Si no se puede aplicar, eso también queda registrado como dato.{g3 ? ` Según el cuidador: ${g3.toLowerCase()}.` : ''}</div>
      <Choices cols2 options={[{ code: 1, label: 'Sí, se aplica' }, { code: 0, label: 'No se puede aplicar' }]} value={p.via_consentimiento ? 1 : p.aplicado}
        onChange={(v) => setP(session, 'P.aplica', v === 1 ? { aplicado: 1, razon: undefined, via_consentimiento: undefined } : { aplicado: 0, via_consentimiento: undefined })} />
      {p.aplicado === 0 && !p.via_consentimiento && (
        <>
          <div className="lbl" style={{ marginBottom: -8 }}>¿Por qué razón?</div>
          <Choices options={PMOD.noAplicaRazones} value={p.razon} onChange={(v) => setP(session, 'P.aplica', { razon: v })} />
          {p.razon === 5 && <TextInput value={p.razon_otro ?? ''} placeholder="¿Cuál?" onCommit={(v) => setP(session, 'P.aplica', { razon_otro: v }, false)} />}
        </>
      )}
    </div>
  );
}

export function ConsentPersonaStep({ session, state, settings }: StepProps) {
  const c = state.consent.persona ?? {};
  const set = (patch: any) => {
    session.update((s) => {
      const next = { ...(s.consent.persona ?? {}), ...patch, ts: new Date().toISOString() };
      s.consent.persona = next;
      const P = (s.answers.P ??= {});
      if (next.comprension === false) Object.assign(P, { aplicado: 0, razon: 4, via_consentimiento: true });
      else if (next.acepta === false) Object.assign(P, { aplicado: 0, razon: 2, via_consentimiento: true });
      else { P.aplicado = 1; delete P.razon; delete P.via_consentimiento; }
    });
    session.event('consent', 'consentimiento.persona', patch);
  };
  const rows: any[] = (settings?.consentimiento_persona ?? []).filter((r: any) => state.consent.cuidador?.audio || r.picto !== 2912);
  return (
    <div className="question">
      <div className="qid">Consentimiento de la persona, en lectura fácil</div>
      <div className="qtext">{T(state, '¿Cómo da [NOMBRE] su consentimiento?')}</div>
      <Choices cols2 value={c.modo === 'papel' ? 1 : c.modo === 'app' ? 2 : undefined} onChange={(v) => set({ modo: v === 1 ? 'papel' : 'app' })}
        options={[{ code: 1, label: 'Ya lo dio en el documento en papel' }, { code: 2, label: 'Lo da aquí, en el tablet' }]} />
      {c.modo === 'app' && (
        <div className="stack">
          {!settings?.consentimiento_aprobado && <div className="notice">Texto en borrador. El documento en lectura fácil aprobado por el Comité Ético Científico se carga desde el portal de administración.</div>}
          {rows.map((r, i) => <EasyRow key={i} picto={r.picto} texto={r.texto} />)}
          <div className="small muted">{PICTO_CREDIT}</div>
        </div>
      )}
      {c.modo && (
        <>
          <div>
            <div className="lbl">{T(state, 'Verificación de comprensión: ¿[NOMBRE] entiende de qué se trata y que puede parar cuando quiera?')}</div>
            <Choices cols2 options={INSTRUMENT.scales.sino} value={c.comprension === true ? 1 : c.comprension === false ? 0 : undefined} onChange={(v) => set({ comprension: v === 1 })} />
          </div>
          {c.comprension === true && (
            <div>
              <div className="lbl">{T(state, '¿[NOMBRE] quiere participar?')}</div>
              <Choices cols2 options={INSTRUMENT.scales.sino} value={c.acepta === true ? 1 : c.acepta === false ? 0 : undefined} onChange={(v) => set({ acepta: v === 1 })} />
            </div>
          )}
          {c.comprension === true && c.acepta === true && c.modo === 'app' && (
            <div>
              <div className="lbl">Firma o marca de la persona (opcional)</div>
              <SignaturePad value={state.geo.firmas?.persona} onChange={(d) => session.update((s) => { s.geo.firmas.persona = d; })} />
            </div>
          )}
          {(c.comprension === false || c.acepta === false) && <div className="notice">El módulo no se aplica. Queda registrado así, sin insistir.</div>}
        </>
      )}
    </div>
  );
}

const variantFromG7 = (g7: any): string | undefined => {
  if (!Array.isArray(g7)) return undefined;
  if (g7.includes(3) || g7.includes(4)) return 'trabajo';
  if (g7.includes(2)) return 'taller';
  if (g7.includes(1)) return 'colegio';
  return undefined;
};

export function PPrepStep({ session, state }: StepProps) {
  const p = state.answers.P ?? {};
  const variantes: any[] = PMOD.actividades.find((a: any) => a.id === 'actividad').variantes;
  useEffect(() => {
    if (!p.variante) { const v = variantFromG7(state.answers.G7); if (v) setP(session, 'P.preparacion', { variante: v }, false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const control: any[] = p.control ?? [];
  const setCtrl = (id: string, esperado: number | null) => {
    let next = control.filter((c) => c.id !== id);
    if (esperado !== null) next = [...next, { id, esperado }];
    setP(session, 'P.preparacion', { control: next });
  };
  const hasNo = control.some((c) => c.esperado === 0);
  return (
    <div className="question">
      <div className="qid">Módulo P, preparación (encuestador)</div>
      <div className="qtext">Antes de entregar el tablet</div>
      <div>
        <div className="lbl">¿El módulo se aplica en un espacio separado del cuidador?</div>
        <Choices cols2 options={INSTRUMENT.scales.sino} value={p.separado} onChange={(v) => setP(session, 'P.preparacion', { separado: v })} />
      </div>
      <div>
        <div className="lbl">{T(state, 'Tarjeta de actividad diaria de [NOMBRE]')}</div>
        <Choices cols2 options={variantes.map((v, i) => ({ code: i, label: v.label }))} value={variantes.findIndex((v) => v.id === p.variante)} onChange={(i) => setP(session, 'P.preparacion', { variante: variantes[i].id })} />
      </div>
      <div className="stack">
        <div>
          <div className="lbl">Tarjetas de control</div>
          <div className="muted">Elija una o dos, y pregunte al cuidador si la persona hace esa actividad. Al menos una debe ser algo que no hace.</div>
        </div>
        {PMOD.control.map((c: any) => {
          const cur = control.find((x) => x.id === c.id);
          const disabled = !cur && control.length >= 2;
          return (
            <div key={c.id} className="row card" style={{ padding: 12, opacity: disabled ? 0.45 : 1 }}>
              <div style={{ width: 72, height: 72, flex: 'none' }}><Picto id={c.picto} alt="" /></div>
              <b className="grow">{c.label}</b>
              <div className="row wrap" style={{ gap: 6 }}>
                {[{ v: 1, l: 'Sí lo hace' }, { v: 0, l: 'No lo hace' }].map((o) => (
                  <button key={o.v} type="button" className="btn sm" disabled={disabled} aria-pressed={cur?.esperado === o.v}
                    style={cur?.esperado === o.v ? { borderColor: 'var(--solo)', background: 'var(--solo-soft)' } : undefined}
                    onClick={() => setCtrl(c.id, cur?.esperado === o.v ? null : o.v)}>{o.l}</button>
                ))}
              </div>
            </div>
          );
        })}
        {control.length > 0 && !hasNo && <div className="notice">Falta una tarjeta de algo que la persona no hace.</div>}
      </div>
    </div>
  );
}

const ABIERTAS: Record<string, string> = { P1a: '¿Cuál es tu lugar favorito del barrio?', P1b: '¿Con quién te gusta salir a caminar?' };

export function PAbiertaStep({ session, state, step, next }: StepProps) {
  const p = state.answers.P ?? {};
  return (
    <div className="question">
      <div className="qid">{T(state, `${step.id === 'P1a' ? 'P1, primera pregunta' : 'P1, segunda pregunta'}. Pregunte a [NOMBRE] y anote lo que responde`)}</div>
      <div className="qtext" style={{ fontSize: '2.3rem' }}>{ABIERTAS[step.id]}</div>
      <TextInput area value={p[step.id] ?? ''} placeholder="Respuesta, con sus palabras" onCommit={(v) => setP(session, step.id, { [step.id]: v, [`${step.id}_nr`]: false }, false)} />
      <div><button type="button" className="btn sm ghost" onClick={() => { setP(session, step.id, { [step.id]: '', [`${step.id}_nr`]: true }); setTimeout(next, 200); }}>{p[`${step.id}_nr`] ? 'Marcado sin respuesta' : 'No respondió'}</button></div>
    </div>
  );
}

function shuffle<T>(xs: T[]): T[] { const a = xs.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export function PTableroStep({ session, state, step }: StepProps) {
  const key = step.id as 'P2' | 'P3' | 'P4';
  const p = state.answers.P ?? {};
  const trat = tratDe(state);
  const def = PMOD[key];
  const cats: any[] = def.categorias;
  const cards: { id: string; label: string; picto: number }[] = useMemo(() => {
    if (key === 'P2') return (p.control ?? []).map((c: any) => PMOD.control.find((x: any) => x.id === c.id));
    return PMOD.actividades.map((a: any) => { const v = a.variantes?.find((x: any) => x.id === p.variante); return v ? { id: a.id, label: v.label, picto: v.picto } : a; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, p.variante, (p.control ?? []).length]);
  const orderKey = `orden_${key}`;
  useEffect(() => {
    if (!p[orderKey] || p[orderKey].length !== cards.length) setP(session, key, { [orderKey]: shuffle(cards.map((c) => c.id)) }, false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.length]);
  const order: string[] = p[orderKey] ?? cards.map((c) => c.id);
  const answers: Record<string, number> = p[key] ?? {};
  const pending = order.filter((id) => answers[id] === undefined);
  const current = cards.find((c) => c.id === pending[0]);
  const shown = useRef(performance.now());
  useEffect(() => { shown.current = performance.now(); }, [current?.id]);
  const [confirmStop, setConfirmStop] = useState(false);

  const save = (next: Record<string, number>, extra: any = {}) => {
    const done = order.every((id) => next[id] !== undefined);
    const patch: any = { [key]: next, [`${key}_listo`]: done, ...extra };
    if (key === 'P2') patch.control = (p.control ?? []).map((c: any) => ({ ...c, respuesta: next[c.id] ?? null }));
    setP(session, key, patch, false);
  };
  const place = (code: number) => {
    if (!current) return;
    const ms = Math.round(performance.now() - shown.current);
    session.event('p_tarjeta', key, { tarjeta: current.id, categoria: code, ms });
    save({ ...answers, [current.id]: code }, { [`ms_${key}`]: { ...(p[`ms_${key}`] ?? {}), [current.id]: ms } });
  };
  const takeBack = (id: string) => {
    const next = { ...answers }; delete next[id];
    session.event('p_tarjeta_retira', key, { tarjeta: id });
    session.update((s) => { s.answers.P[`cambios_${key}`] = (s.answers.P[`cambios_${key}`] ?? 0) + 1; });
    save(next);
  };

  if (p.detenido) return <div className="question"><div className="qtext">El módulo se detuvo.</div><div className="qhelp">Quedó registrado hasta donde se alcanzó. Agradezca a la persona y continúe.</div></div>;

  return (
    <div className="pboard">
      <div className="pq">{def.pregunta}</div>
      {current ? (
        <div className="pcard enter" key={current.id}>
          <Picto id={current.picto} alt="" />
          <div className="lab">{current.label}</div>
        </div>
      ) : <div className="pdone"><div className="row"><div style={{ width: 90 }}><Picto id={5358} alt="" /></div>¡Listo! Muchas gracias.</div></div>}
      <div className="pcols" style={{ gridTemplateColumns: `repeat(${cats.length}, 1fr)` }}>
        {cats.map((c) => (
          <div key={c.code} role="button" tabIndex={0} className={'pcol ' + (c.tone ?? (c.code === 1 ? 'si' : 'no'))} onClick={() => place(c.code)} onKeyDown={(e) => e.key === 'Enter' && place(c.code)}>
            <div className="head"><Picto id={c.picto} alt="" /><span>{tx(c.label, undefined, trat)}</span></div>
            <div className="pmini">
              {order.filter((id) => answers[id] === c.code).map((id) => { const card = cards.find((x) => x.id === id)!; return (
                <button key={id} type="button" aria-label={`Sacar ${card.label}`} onClick={(e) => { e.stopPropagation(); takeBack(id); }}><Picto id={card.picto} alt={card.label} /></button>
              ); })}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{key}. {order.length - pending.length} de {order.length} tarjetas. Toque una tarjeta ya puesta para sacarla.</span>
        <span className="row">
          {current && <button type="button" className="btn sm" onClick={() => place(NR)}>No responde esta tarjeta</button>}
          <button type="button" className="btn sm" onClick={() => setConfirmStop(true)}>Detener el módulo</button>
        </span>
      </div>
      {confirmStop && (
        <div className="modal-bg"><div className="modal">
          <h2>¿Detener el módulo aquí?</h2>
          <p className="muted">Se guarda lo respondido hasta ahora y no se muestran más tarjetas.</p>
          <div className="row"><button type="button" className="btn danger" onClick={() => { setP(session, key, { detenido: true, detenido_en: key }); setConfirmStop(false); }}>Detener</button><button type="button" className="btn" onClick={() => setConfirmStop(false)}>Seguir</button></div>
        </div></div>
      )}
    </div>
  );
}
