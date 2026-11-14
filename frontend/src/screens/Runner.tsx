import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RecPill, SyncPill } from '../components/StatusPills';
import { Choices, Modal, TextInput, useStore } from '../components/ui';
import { getRecState, keepAwake, startRecording, stopRecording, subscribeRec } from '../lib/audio';
import { useConfig } from '../lib/config';
import { computeSteps, filterFailed, stepComplete, type Step } from '../lib/flow';
import { BLOCKS } from '../lib/instrument';
import { SurveySession } from '../lib/store';
import { exportLocalBackup, surveyBackup, subscribeSync, syncNow, getSyncStatus } from '../lib/sync';
import { A2Step, A4Step, ConsentCuidadorStep, IntroStep, ItemStep } from '../steps/basic';
import type { StepProps } from '../steps/common';
import { ConcernsStep, DestListaStep, DestMapaStep, DestNombreStep, OrdenStep, PolygonStep, RutaStep } from '../steps/maps';
import { ConsentPersonaStep, PAbiertaStep, PAplicaStep, PPrepStep, PTableroStep } from '../steps/pmod';

const VIEWS: Record<string, (p: StepProps) => JSX.Element> = {
  item: ItemStep, intro: IntroStep, consentCuidador: ConsentCuidadorStep, A2: A2Step, A4: A4Step,
  poligono: PolygonStep, preocupaciones: ConcernsStep, destNombre: DestNombreStep, destMapa: DestMapaStep,
  destLista: DestListaStep, orden: OrdenStep, ruta: RutaStep, pAplica: PAplicaStep, consentPersona: ConsentPersonaStep,
  pPrep: PPrepStep, pAbierta: PAbiertaStep, pTablero: PTableroStep,
};
const MAP_KINDS = new Set(['poligono', 'preocupaciones', 'destMapa', 'ruta', 'pTablero']);
const END_REASONS = [
  { code: 1, label: 'El cuidador no quiso continuar' }, { code: 2, label: 'Se acabó el tiempo disponible' },
  { code: 3, label: 'Problema técnico' }, { code: 4, label: 'Otra razón' },
];

export default function Runner() {
  const { id } = useParams();
  const nav = useNavigate();
  const cfg = useConfig();
  const [session, setSession] = useState<SurveySession | null | undefined>(undefined);
  useEffect(() => { SurveySession.load(id!).then(setSession); }, [id]);
  if (session === undefined) return <div className="page">Cargando la encuesta</div>;
  if (session === null) return <div className="page"><h1>Esta encuesta no está en este tablet</h1><button className="btn" onClick={() => nav('/')}>Volver al inicio</button></div>;
  return <RunnerInner session={session} cfg={cfg} />;
}

function RunnerInner({ session, cfg }: { session: SurveySession; cfg: any }) {
  const nav = useNavigate();
  useStore(session.subscribe, session.getVersion);
  const state = session.state;
  const steps = useMemo(() => computeSteps(state), [session.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const [curId, setCurId] = useState<string>(() => (steps.some((s) => s.id === state.cursor) ? state.cursor : steps[0].id));
  const prevIdx = useRef(0);
  const [menu, setMenu] = useState(false);
  const terminal = state.status !== 'en_curso';

  // si la secuencia cambia por una respuesta y la pantalla actual desaparece, se queda en la misma posición
  let i = steps.findIndex((s) => s.id === curId);
  if (i < 0) i = Math.min(prevIdx.current, steps.length - 1);
  prevIdx.current = i;
  const step: Step = steps[i];

  useEffect(() => { if (!terminal) session.enter(step.id); }, [step.id, terminal, session]);
  useEffect(() => {
    const vis = () => session.setVisible(document.visibilityState === 'visible');
    const hide = () => { session.tick(); session.flush(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('pagehide', hide);
    const conn = () => session.event(navigator.onLine ? 'online' : 'offline');
    window.addEventListener('online', conn); window.addEventListener('offline', conn);
    keepAwake();
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pagehide', hide); window.removeEventListener('online', conn); window.removeEventListener('offline', conn); session.leave(); stopRecording(); };
  }, [session]);

  const wantsAudio = state.consent?.cuidador?.acepta === true && state.consent?.cuidador?.audio === true && !terminal;
  const rec = useStore(subscribeRec, getRecState);
  useEffect(() => { if (wantsAudio && !getRecState().recording) startRecording(session); if (!wantsAudio) stopRecording(); }, [wantsAudio, session]);

  const go = (n: number) => setCurId(steps[Math.max(0, Math.min(steps.length - 1, n))].id);
  const goTo = (sid: string) => setCurId(sid);
  const complete = stepComplete(step, state);
  const next = () => {
    const fresh = computeSteps(session.state);
    const k = fresh.findIndex((s) => s.id === step.id);
    if (k >= 0 && stepComplete(fresh[k], session.state)) setCurId(fresh[Math.min(fresh.length - 1, k + 1)].id);
  };

  const finalize = async (status: string, extra: any = {}) => {
    session.leave();
    await session.update((s) => { s.status = status; s.meta.completed_at = new Date().toISOString(); Object.assign(s.meta, extra); });
    session.event('survey_end', undefined, { status, ...extra });
    stopRecording();
    await session.flush();
    syncNow();
  };

  if (terminal) return <Final session={session} />;

  const block = BLOCKS.find((b) => b.id === step.block);
  const bIdx = BLOCKS.findIndex((b) => b.id === step.block);
  const View = VIEWS[step.kind];
  const props: StepProps = { session, state, step, token: cfg?.mapbox_token ?? '', settings: cfg?.settings ?? {}, next, goTo };
  const isMap = MAP_KINDS.has(step.kind);
  const needsMapToken = isMap && step.kind !== 'pTablero' && !cfg;

  return (
    <div className="runner">
      <header className="topbar">
        <span className="blockchip">{block ? block.id : step.block === 'cierre' ? '✓' : 'i'}</span>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{block?.titulo ?? (step.block === 'cierre' ? 'Cierre' : 'Inicio')}</div>
          <div className="progress" aria-label={`Bloque ${bIdx + 1} de ${BLOCKS.length}`}>{BLOCKS.map((b, k) => <i key={b.id} className={k < bIdx || step.block === 'cierre' ? 'done' : k === bIdx ? 'now' : ''} />)}</div>
        </div>
        {step.who && <span className={'who ' + step.who}>{step.who === 'cuidador' ? 'Dibuja el cuidador' : `Responde ${state.geo.nombre || 'la persona'}`}</span>}
        {state.is_test && <span className="tag warn">Prueba</span>}
        <RecPill wanted={wantsAudio} onRetry={() => startRecording(session)} />
        <SyncPill />
        <button type="button" className="btn sm" onClick={() => setMenu(true)}>Opciones</button>
      </header>
      {session.saveError && <div className="notice bad" style={{ borderRadius: 0 }}>No se pudo guardar en el tablet ({session.saveError}). No cierre la aplicación y avise al investigador.</div>}
      {wantsAudio && rec.error && !rec.recording && <div className="notice bad" style={{ borderRadius: 0 }}>{rec.error}. La encuesta puede continuar; toque el aviso de grabación para reintentar.</div>}
      <main className={'stage' + (isMap ? ' fill' : '')} key={step.id}>
        {step.kind === 'cierre' ? <Cierre session={session} state={state} finalize={finalize} />
          : needsMapToken ? <div className="question"><div className="notice bad">No se pudo cargar la configuración del mapa. Conéctese a internet una vez para descargarla.</div></div>
          : <View {...props} />}
      </main>
      <footer className="bottombar">
        <button type="button" className="btn" disabled={i === 0} onClick={() => go(i - 1)}>Atrás</button>
        <span className="grow small muted center">{state.codigo}</span>
        {step.kind !== 'cierre' && <button type="button" className="btn primary" style={{ minWidth: 180 }} disabled={!complete} onClick={next}>Siguiente</button>}
      </footer>
      {menu && <Menu session={session} step={step} onClose={() => setMenu(false)} onEnd={(extra) => { setMenu(false); finalize('interrumpida', extra); }} onExit={() => nav('/')} />}
    </div>
  );
}

function Menu({ session, step, onClose, onEnd, onExit }: { session: SurveySession; step: Step; onClose: () => void; onEnd: (x: any) => void; onExit: () => void }) {
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);
  const [reason, setReason] = useState<number>();
  const [why, setWhy] = useState('');
  return (
    <Modal onClose={onClose}>
      <h2>Opciones</h2>
      {!ending ? (
        <>
          <div>
            <label className="lbl" htmlFor="nota">Observación del encuestador sobre esta pantalla</label>
            <textarea id="nota" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Por ejemplo: el cuidador dudó entre dos opciones" />
            <button type="button" className="btn sm" style={{ marginTop: 8 }} disabled={!note.trim()} onClick={() => { session.update((s) => { s.notas.push({ t: new Date().toISOString(), item: step.id, texto: note.trim() }); }); session.event('nota', step.id); setNote(''); onClose(); }}>Guardar observación</button>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={() => { session.leave(); session.flush().then(onExit); }}>Pausar y volver al inicio</button>
            <button type="button" className="btn" onClick={() => exportLocalBackup(session.id)}>Guardar una copia de respaldo en este tablet</button>
            <button type="button" className="btn" onClick={() => setEnding(true)}>Terminar la encuesta antes de tiempo</button>
            <button type="button" className="btn ghost" onClick={onClose}>Cerrar</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Lo respondido hasta ahora queda guardado y la encuesta se registra como interrumpida.</p>
          <Choices options={END_REASONS} value={reason} onChange={setReason} />
          <TextInput value={why} placeholder="Detalle (opcional)" onCommit={setWhy} />
          <div className="row">
            <button type="button" className="btn danger" disabled={!reason} onClick={() => onEnd({ end_reason: END_REASONS.find((r) => r.code === reason)!.label, end_note: why })}>Terminar ahora</button>
            <button type="button" className="btn" onClick={() => setEnding(false)}>Volver</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Cierre({ session, state, finalize }: { session: SurveySession; state: any; finalize: (status: string, extra?: any) => void }) {
  const noConsent = state.consent?.cuidador?.acepta === false;
  const filtro = filterFailed(state.answers);
  if (noConsent) return (
    <div className="question"><div className="qtext">La encuesta no se aplica porque no hay consentimiento.</div>
      <div><button className="btn primary" onClick={() => finalize('interrumpida', { end_reason: 'Sin consentimiento del cuidador' })}>Cerrar y registrar</button></div></div>
  );
  if (filtro) return (
    <div className="question"><div className="qtext">Esta díada no cumple los criterios del estudio.</div>
      <div className="qhelp">El estudio considera a personas con síndrome de Down de 18 años o más que viven en el Gran Santiago, junto a su cuidador principal. Agradezca y cierre la encuesta. Si marcó una respuesta por error, vuelva atrás y corríjala.</div>
      <div><button className="btn primary" onClick={() => finalize('terminada_filtro')}>Cerrar y registrar</button></div></div>
  );
  return (
    <div className="question">
      <div className="qid">Cierre</div>
      <div className="qtext">Eso es todo. Agradezca al cuidador{state.answers.P?.aplicado === 1 ? ` y a ${state.geo.nombre}` : ''}.</div>
      <div>
        <label className="lbl">Observaciones generales del encuestador (opcional)</label>
        <TextInput area value={state.meta.observaciones ?? ''} placeholder="Interrupciones, presencia de otras personas, dudas con alguna consigna" onCommit={(v) => session.update((s) => { s.meta.observaciones = v; })} />
      </div>
      <div><button className="btn primary" style={{ minWidth: 280 }} onClick={() => finalize('completada')}>Finalizar y enviar</button></div>
      <div className="muted">Después de finalizar, las respuestas ya no se pueden modificar desde el tablet.</div>
    </div>
  );
}

const STATUS_TXT: Record<string, string> = { completada: 'Encuesta finalizada', terminada_filtro: 'Encuesta cerrada en el filtro', interrumpida: 'Encuesta interrumpida' };

function Final({ session }: { session: SurveySession }) {
  const nav = useNavigate();
  useStore(subscribeSync, getSyncStatus);
  const [b, setB] = useState<any>(null);
  useEffect(() => { let on = true; const run = () => surveyBackup(session.id).then((x) => on && setB(x)); run(); const t = setInterval(run, 1500); return () => { on = false; clearInterval(t); }; }, [session.id]);
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1>{STATUS_TXT[session.state.status]}</h1>
      <div className="muted">Código de la díada: <b style={{ color: 'var(--ink)' }}>{session.state.codigo}</b></div>
      {b?.complete ? (
        <div className="notice good"><b>Todo quedó respaldado en el servidor.</b> El investigador recibe un correo de confirmación.</div>
      ) : b?.deleted ? (
        <div className="notice">El administrador eliminó esta encuesta de la base de datos.</div>
      ) : (
        <div className="notice">
          <b>Guardada en este tablet. Falta enviarla al servidor.</b>
          <div>Se envía sola cuando haya conexión. Mientras tanto, no borre los datos del navegador ni desinstale la aplicación.</div>
          {b && <div className="small" style={{ marginTop: 6 }}>Pendiente: {b.state ? '' : 'respuestas, '}{b.events} registros de trazabilidad, {b.audio} fragmentos de audio.</div>}
        </div>
      )}
      <div className="row wrap">
        <button className="btn primary" onClick={() => nav('/')}>Volver al inicio</button>
        {!b?.complete && <button className="btn" onClick={() => syncNow()}>Intentar enviar ahora</button>}
        <button className="btn" onClick={() => exportLocalBackup(session.id)}>Guardar una copia en este tablet</button>
      </div>
    </div>
  );
}
