import { getRecState, subscribeRec } from '../lib/audio';
import { getSyncStatus, isAllSynced, subscribeSync } from '../lib/sync';
import { useStore } from './ui';

export function SyncPill() {
  const s = useStore(subscribeSync, getSyncStatus);
  const n = s.pending.surveys + s.pending.events + s.pending.audio;
  if (s.needsLogin) return <span className="pill bad"><span className="dot" />Sesión vencida: los datos siguen guardados en el tablet</span>;
  if (!s.online) return <span className="pill warn"><span className="dot" />Sin conexión, guardando en el tablet</span>;
  if (isAllSynced(s)) return <span className="pill ok"><span className="dot" />Respaldado en el servidor</span>;
  return <span className="pill warn"><span className="dot" />{s.running ? 'Enviando' : 'Pendiente de envío'} ({n})</span>;
}

export function RecPill({ wanted, onRetry }: { wanted: boolean; onRetry: () => void }) {
  const r = useStore(subscribeRec, getRecState);
  if (!wanted) return <span className="pill"><span className="dot" />Sin grabación</span>;
  if (r.recording) return <span className="pill rec"><span className="dot" />Grabando</span>;
  return <button type="button" className="pill bad" onClick={onRetry}><span className="dot" />No se está grabando. Tocar para reintentar</button>;
}
