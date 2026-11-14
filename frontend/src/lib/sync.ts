import { api, ApiError, getSession } from './api';
import { db } from './db';

export type SyncStatus = {
  online: boolean; running: boolean; lastOk: number | null; error: string | null; needsLogin: boolean;
  pending: { surveys: number; events: number; audio: number };
};
let status: SyncStatus = { online: navigator.onLine, running: false, lastOk: null, error: null, needsLogin: false, pending: { surveys: 0, events: 0, audio: 0 } };
const listeners = new Set<() => void>();
const set = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; listeners.forEach((l) => l()); };
export const subscribeSync = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getSyncStatus = () => status;
export const isAllSynced = (s: SyncStatus) => s.pending.surveys + s.pending.events + s.pending.audio === 0;

const TERMINAL = ['completada', 'terminada_filtro', 'interrumpida'];

export async function countPending() {
  const me = getSession()?.email;
  const rows = await db.surveys.toArray();
  const mine = rows.filter((r) => !r.serverDeleted && (!me || r.owner === me));
  const ids = new Set(mine.map((r) => r.id));
  let events = 0, audio = 0;
  for (const id of ids) {
    events += await db.events.where('[surveyId+synced]').equals([id, 0]).count();
    audio += await db.audio.where('[surveyId+synced]').equals([id, 0]).count();
  }
  const pending = { surveys: mine.filter((r) => r.syncedRev < r.rev).length, events, audio };
  set({ pending });
  return pending;
}

/** Estado de respaldo de una encuesta en particular. */
export async function surveyBackup(id: string) {
  const row = await db.surveys.get(id);
  const events = await db.events.where('[surveyId+synced]').equals([id, 0]).count();
  const audio = await db.audio.where('[surveyId+synced]').equals([id, 0]).count();
  return { state: !!row && row.syncedRev >= row.rev, events, audio, deleted: !!row?.serverDeleted,
    complete: !!row && row.syncedRev >= row.rev && events === 0 && audio === 0 };
}

async function syncSurvey(id: string) {
  let row = await db.surveys.get(id);
  if (!row || row.serverDeleted) return;
  try {
    if (row.syncedRev < row.rev) {
      const sent = row.rev;
      await api(`/surveys/${id}`, { method: 'PUT', json: { rev: sent, status: row.status, state: row.state } });
      await db.surveys.where('id').equals(id).modify((r) => { r.syncedRev = Math.max(r.syncedRev, sent); r.lastSyncAt = Date.now(); });
    }
    for (;;) {
      const batch = await db.events.where('[surveyId+synced]').equals([id, 0]).limit(300).toArray();
      if (!batch.length) break;
      await api(`/surveys/${id}/events`, { json: { events: batch.map(({ seq, t, type, item, data }) => ({ seq, t, type, item, data })) } });
      await db.events.bulkUpdate(batch.map((e) => ({ key: e.lid!, changes: { synced: 1 as const } })));
    }
    for (;;) {
      const chunks = await db.audio.where('[surveyId+synced]').equals([id, 0]).limit(5).toArray();
      if (!chunks.length) break;
      for (const c of chunks) {
        await api(`/surveys/${id}/audio/${c.segment}/${c.seq}`, { method: 'PUT', body: c.data, headers: { 'Content-Type': c.mime }, timeout: 120000 });
        await db.audio.update([c.surveyId, c.segment, c.seq], { synced: 1 });
      }
    }
    // Encuesta cerrada y todo arriba: se verifica contra el servidor antes de liberar el audio local.
    row = await db.surveys.get(id);
    if (row && TERMINAL.includes(row.status) && row.syncedRev >= row.rev) {
      const localAudio = await db.audio.where('surveyId').equals(id).count();
      if (localAudio > 0) {
        const rec = await api(`/surveys/${id}/receipt`);
        const serverAudio = Object.values(rec.audio as Record<string, number>).reduce((a, b) => a + b, 0);
        if (rec.rev >= row.rev && serverAudio >= localAudio) {
          await db.audio.where('surveyId').equals(id).modify((a) => { a.data = new ArrayBuffer(0); });
        }
      }
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) {
      await db.surveys.update(id, { serverDeleted: true });
      await db.audio.where('surveyId').equals(id).delete();
      return;
    }
    throw e;
  }
}

let again = false;
export async function syncNow(): Promise<void> {
  if (!getSession()) return;
  if (status.running) { again = true; return; }
  set({ running: true });
  try {
    const me = getSession()!.email;
    const rows = (await db.surveys.toArray()).filter((r) => r.owner === me && !r.serverDeleted);
    for (const r of rows) await syncSurvey(r.id);
    const p = await countPending();
    set({ error: null, needsLogin: false, lastOk: p.surveys + p.events + p.audio === 0 ? Date.now() : status.lastOk, online: true });
  } catch (e: any) {
    const needsLogin = e instanceof ApiError && e.status === 401;
    set({ error: e?.message ?? 'Error de sincronización', needsLogin, online: e instanceof ApiError && e.status === 0 ? false : navigator.onLine });
    await countPending().catch(() => {});
  } finally {
    set({ running: false });
    if (again) { again = false; setTimeout(syncNow, 200); }
  }
}

let timer: any = null;
export function kickSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { set({ online: true }); syncNow(); });
  window.addEventListener('offline', () => set({ online: false }));
  setInterval(syncNow, 20000);
  countPending().catch(() => {});
  syncNow();
}

/** Copia de seguridad manual: todo lo que el tablet tiene de una encuesta, en un archivo. */
export async function exportLocalBackup(id: string) {
  const row = await db.surveys.get(id);
  const events = await db.events.where('[surveyId+seq]').between([id, 0], [id, Infinity]).toArray();
  const blob = new Blob([JSON.stringify({ exportado: new Date().toISOString(), survey: row, events }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo_${row?.state?.codigo ?? id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
