import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SyncPill } from '../components/StatusPills';
import { Choices, fmtDate, Modal, TextInput, useStore } from '../components/ui';
import { getSession, setSession } from '../lib/api';
import { audioSupported } from '../lib/audio';
import { useConfig } from '../lib/config';
import { db, requestPersistence, type SurveyRow } from '../lib/db';
import { SurveySession } from '../lib/store';
import { exportLocalBackup, getSyncStatus, isAllSynced, subscribeSync, surveyBackup, syncNow } from '../lib/sync';

const ST: Record<string, [string, string]> = { en_curso: ['En curso', 'warn'], completada: ['Completada', 'ok'], terminada_filtro: ['Cerrada en el filtro', ''], interrumpida: ['Interrumpida', 'bad'] };

export default function Home({ updateReady, applyUpdate }: { updateReady: boolean; applyUpdate: () => void }) {
  const me = getSession()!;
  const nav = useNavigate();
  const cfg = useConfig();
  const sync = useStore(subscribeSync, getSyncStatus);
  const [rows, setRows] = useState<(SurveyRow & { backup?: any })[]>([]);
  const [creating, setCreating] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [mic, setMic] = useState<string>('sin revisar');

  const refresh = async () => {
    const all = (await db.surveys.where('owner').equals(me.email).toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
    setRows(await Promise.all(all.map(async (r) => ({ ...r, backup: await surveyBackup(r.id) }))));
  };
  useEffect(() => { refresh(); }, [sync.pending.surveys, sync.pending.events, sync.pending.audio, sync.lastOk]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    requestPersistence().then(setPersisted);
    (navigator.permissions as any)?.query({ name: 'microphone' }).then((p: any) => setMic(p.state === 'granted' ? 'permitido' : p.state === 'denied' ? 'bloqueado' : 'se pedirá al grabar')).catch(() => setMic(audioSupported() ? 'se pedirá al grabar' : 'no disponible'));
  }, []);

  const logout = () => {
    if (!isAllSynced(sync) && !confirm('Hay datos que todavía no se envían al servidor. Siguen guardados en este tablet, pero solo se enviarán cuando vuelva a iniciar sesión con este mismo usuario. ¿Cerrar sesión igual?')) return;
    setSession(null);
  };
  const removeLocal = async (r: SurveyRow) => {
    if (!confirm(`¿Quitar ${r.state.codigo} de este tablet? Ya está respaldada en el servidor.`)) return;
    await db.transaction('rw', db.surveys, db.events, db.audio, async () => {
      await db.events.where('surveyId').equals(r.id).delete();
      await db.audio.where('surveyId').equals(r.id).delete();
      await db.surveys.delete(r.id);
    });
    refresh();
  };

  return (
    <>
      <div className="navbar">
        <span className="brand">Encuesta de Díadas</span>
        <span className="grow" />
        <SyncPill />
        {me.role === 'admin' && <Link className="btn sm" to="/admin">Portal de administración</Link>}
        <span className="small muted">{me.name}</span>
        <button className="btn sm" onClick={logout}>Cerrar sesión</button>
      </div>
      <div className="page">
        {updateReady && <div className="notice info row"><span className="grow">Hay una versión nueva de la aplicación.</span><button className="btn sm" onClick={applyUpdate}>Actualizar ahora</button></div>}
        <div className="row wrap" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1>Hola, {me.name.split(' ')[0]}</h1>
            <p className="muted" style={{ marginTop: 6 }}>Cada respuesta se guarda en este tablet en el momento y se envía al servidor cuando hay conexión.</p>
          </div>
          <button className="btn primary" style={{ minWidth: 240 }} onClick={() => setCreating(true)}>Nueva encuesta</button>
        </div>

        <div className="row wrap">
          <span className={'pill ' + (sync.online ? 'ok' : 'warn')}><span className="dot" />{sync.online ? 'Con conexión' : 'Sin conexión'}</span>
          <span className={'pill ' + (cfg?.mapbox_token ? 'ok' : 'bad')}><span className="dot" />{cfg?.mapbox_token ? 'Mapa configurado' : 'Mapa sin configurar'}</span>
          <span className={'pill ' + (mic === 'bloqueado' || mic === 'no disponible' ? 'bad' : 'ok')}><span className="dot" />Micrófono: {mic}</span>
          <span className={'pill ' + (persisted ? 'ok' : 'warn')}><span className="dot" />{persisted ? 'Almacenamiento protegido' : 'Almacenamiento sin protección especial'}</span>
        </div>
        {sync.error && sync.online && !sync.needsLogin && <div className="notice">Último intento de envío: {sync.error}</div>}
        {sync.needsLogin && <div className="notice bad">La sesión venció. Cierre sesión y vuelva a entrar con conexión para enviar lo pendiente. Los datos siguen guardados en este tablet.</div>}

        <div className="stack">
          <h2>Encuestas en este tablet</h2>
          {rows.length === 0 ? <div className="card muted">Todavía no hay encuestas. Toque «Nueva encuesta» para empezar.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table className="t">
                <thead><tr><th>Código</th><th>Estado</th><th>Inicio</th><th>Respaldo en el servidor</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><b>{r.state.codigo}</b>{r.state.is_test && <> <span className="tag warn">Prueba</span></>}</td>
                      <td><span className={'tag ' + ST[r.status][1]}>{ST[r.status][0]}</span></td>
                      <td>{fmtDate(r.state.meta.started_at)}</td>
                      <td>{r.backup?.deleted ? <span className="tag">Eliminada por el administrador</span> : r.backup?.complete ? <span className="tag ok">Completo</span> : <span className="tag warn">Pendiente{r.backup ? ` (${(r.backup.state ? 0 : 1) + r.backup.events + r.backup.audio})` : ''}</span>}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.status === 'en_curso' && <button className="btn sm primary" onClick={() => nav('/encuesta/' + r.id)}>Continuar</button>}{' '}
                        <button className="btn sm" onClick={() => exportLocalBackup(r.id)}>Copia local</button>{' '}
                        {r.status !== 'en_curso' && (r.backup?.complete || r.backup?.deleted) && <button className="btn sm" onClick={() => removeLocal(r)}>Quitar del tablet</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!isAllSynced(sync) && <div><button className="btn sm" onClick={() => syncNow()}>Enviar lo pendiente ahora</button></div>}
        </div>
      </div>
      {creating && <NewSurvey cfg={cfg} onClose={() => setCreating(false)} onCreated={(id) => nav('/encuesta/' + id)} />}
    </>
  );
}

function NewSurvey({ cfg, onClose, onCreated }: { cfg: any; onClose: () => void; onCreated: (id: string) => void }) {
  const [lugar, setLugar] = useState<number>();
  const [otro, setOtro] = useState('');
  const [test, setTest] = useState<number>();
  const lugares = ['domicilio', 'centro_uc', 'otro'];
  return (
    <Modal onClose={onClose}>
      <h2>Nueva encuesta</h2>
      <div><div className="lbl">¿Dónde se aplica?</div>
        <Choices options={[{ code: 0, label: 'En el domicilio' }, { code: 1, label: 'En el Centro UC Síndrome de Down' }, { code: 2, label: 'En otro lugar' }]} value={lugar} onChange={setLugar} />
        {lugar === 2 && <div style={{ marginTop: 8 }}><TextInput value={otro} placeholder="¿Dónde?" onCommit={setOtro} /></div>}
      </div>
      <div><div className="lbl">¿Es una encuesta real o de prueba?</div>
        <Choices cols2 options={[{ code: 0, label: 'Real' }, { code: 1, label: 'De prueba', hint: 'no entra en la muestra' }]} value={test} onChange={setTest} />
      </div>
      {!cfg && <div className="notice">No se pudo obtener la configuración del estudio. Conéctese a internet antes de empezar.</div>}
      <div className="row">
        <button className="btn primary" disabled={lugar === undefined || test === undefined || !cfg} onClick={async () => { const s = await SurveySession.create(cfg.settings, { is_test: test === 1, lugar: lugares[lugar!], lugar_otro: otro }); onCreated(s.id); }}>Empezar</button>
        <button className="btn" onClick={onClose}>Cancelar</button>
      </div>
    </Modal>
  );
}
