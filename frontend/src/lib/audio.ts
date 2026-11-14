import { db } from './db';
import type { SurveySession } from './store';
import { kickSync } from './sync';

export type RecState = { recording: boolean; error: string | null; since: number | null };
let state: RecState = { recording: false, error: null, since: null };
const listeners = new Set<() => void>();
const set = (p: Partial<RecState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); };
export const subscribeRec = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getRecState = () => state;

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let wake: any = null;

function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return options.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) ?? '';
}

export const audioSupported = () => !!((navigator as any).mediaDevices?.getUserMedia && (window as any).MediaRecorder);

/** Inicia un tramo de grabación. Cada fragmento de 10 segundos se guarda de inmediato en el tablet. */
export async function startRecording(session: SurveySession): Promise<boolean> {
  if (recorder && recorder.state !== 'inactive') return true;
  if (!audioSupported()) { set({ error: 'Este navegador no permite grabar audio' }); return false; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    const mime = pickMime();
    recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
    const segment = (session.state.audio.segments as any[]).length;
    const realMime = recorder.mimeType || mime || 'audio/webm';
    let seq = 0;
    const sid = session.id;
    recorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      const n = seq++;
      try {
        const data = await e.data.arrayBuffer();
        await db.audio.put({ surveyId: sid, segment, seq: n, mime: realMime, data, size: data.byteLength, synced: 0 });
        kickSync(4000);
      } catch (err: any) {
        set({ error: 'No se pudo guardar el audio en el dispositivo: ' + (err?.message ?? err) });
      }
    };
    recorder.onerror = (e: any) => { set({ error: 'Error de grabación: ' + (e?.error?.message ?? 'desconocido'), recording: false }); session.event('audio_error', undefined, { msg: String(e?.error?.message ?? '') }); };
    recorder.onstop = () => {
      set({ recording: false, since: null });
      session.update((s) => { const seg = s.audio.segments[segment]; if (seg) { seg.ended_at = new Date().toISOString(); seg.chunks = seq; } });
      session.event('audio_stop', undefined, { segment, chunks: seq });
    };
    stream.getAudioTracks()[0].onended = () => { if (recorder?.state === 'recording') recorder.stop(); set({ error: 'El micrófono se desconectó' }); };
    recorder.start(10000);
    await session.update((s) => { s.audio.segments.push({ n: segment, mime: realMime, started_at: new Date().toISOString() }); });
    session.event('audio_start', undefined, { segment, mime: realMime });
    set({ recording: true, error: null, since: Date.now() });
    try { wake = await (navigator as any).wakeLock?.request('screen'); } catch { /* no disponible */ }
    return true;
  } catch (err: any) {
    const msg = err?.name === 'NotAllowedError' ? 'No hay permiso para usar el micrófono' : 'No se pudo iniciar la grabación: ' + (err?.message ?? err);
    set({ error: msg, recording: false });
    session.event('audio_error', undefined, { msg });
    return false;
  }
}

export function stopRecording() {
  try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ya detenido */ }
  stream?.getTracks().forEach((t) => t.stop());
  recorder = null; stream = null;
  try { wake?.release(); } catch { /* nada */ }
  wake = null;
}

/** Mantiene la pantalla encendida durante la encuesta aunque no se grabe audio. */
export async function keepAwake() {
  try { if (!wake) wake = await (navigator as any).wakeLock?.request('screen'); } catch { /* no disponible */ }
}
