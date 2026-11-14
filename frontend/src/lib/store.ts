import { getSession } from './api';
import { db, type SurveyRow } from './db';
import { INSTRUMENT, ITEMS } from './instrument';
import { kickSync } from './sync';

export const APP_VERSION = '1.0.0';
const iso = () => new Date().toISOString();

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === 'y' ? 8 : 0)).toString(16));
}
const shortId = () => Math.random().toString(36).slice(2, 8);

function makeCodigo(): string {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  let r = '';
  for (let i = 0; i < 4; i++) r += abc[Math.floor(Math.random() * abc.length)];
  return `D${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${r}`;
}

/** Sesión de una encuesta: estado en memoria, guardado inmediato en el tablet, bitácora y tiempos. */
export class SurveySession {
  state: any;
  private row!: SurveyRow;
  private listeners = new Set<() => void>();
  private version = 0;
  private chain: Promise<any> = Promise.resolve();
  private seq = 0;
  private cur: { id: string; t0: number } | null = null;
  saveError: string | null = null;

  static async create(config: any, opts: { is_test: boolean; lugar: string; lugar_otro?: string }): Promise<SurveySession> {
    const user = getSession()!;
    const reserve = config?.incluir_reserva !== false;
    const latent = (l: string) => Object.keys(ITEMS).filter((k) => ITEMS[k].latent === l && (reserve || !ITEMS[k].reserve));
    const id = newId();
    const s = new SurveySession();
    s.state = {
      id, codigo: makeCodigo(), schema: 1, instrument_version: INSTRUMENT.version, app_version: APP_VERSION,
      status: 'en_curso', is_test: opts.is_test,
      interviewer: { email: user.email, name: user.name },
      device: { ua: navigator.userAgent, pantalla: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, idioma: navigator.language, tactil: navigator.maxTouchPoints > 0 },
      config: { fase: config?.fase ?? 'piloto', incluir_reserva: reserve, tareas: { B3: true, C8: true, C9: true, C10: true, ...(config?.tareas ?? {}) } },
      meta: { started_at: iso(), completed_at: null, lugar: opts.lugar, lugar_otro: opts.lugar_otro ?? '' },
      consent: {}, cursor: null,
      answers: { destinos: [], E_orden: shuffle(latent('E')), F_orden: shuffle(latent('F')), P: {} },
      geo: { B3: [], destinos: {}, rutas: {}, firmas: {} },
      mapas: {}, timings: {}, notas: [], audio: { segments: [] },
    };
    s.row = { id, state: s.state, rev: 0, syncedRev: -1, status: 'en_curso', updatedAt: Date.now(), owner: user.email };
    s.event('survey_start', undefined, { codigo: s.state.codigo, online: navigator.onLine });
    await s.persist();
    return s;
  }

  static async load(id: string): Promise<SurveySession | null> {
    const row = await db.surveys.get(id);
    if (!row) return null;
    const s = new SurveySession();
    s.row = row;
    s.state = row.state;
    const last = await db.events.where('[surveyId+seq]').between([id, 0], [id, Infinity]).last();
    s.seq = last?.seq ?? 0;
    return s;
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  get id() { return this.state.id as string; }

  private persist(): Promise<void> {
    this.row.rev += 1;
    this.row.state = this.state;
    this.row.status = this.state.status;
    this.row.updatedAt = Date.now();
    this.state.rev = this.row.rev;
    const snapshot = { ...this.row, state: JSON.parse(JSON.stringify(this.state)) };
    this.chain = this.chain.then(async () => {
      const kept = await db.surveys.get(this.row.id);
      if (kept) { snapshot.syncedRev = kept.syncedRev; snapshot.serverDeleted = kept.serverDeleted; snapshot.lastSyncAt = kept.lastSyncAt; }
      await db.surveys.put(snapshot);
      this.saveError = null;
    }).catch((e) => {
      this.saveError = String(e?.message ?? e);
      console.error('No se pudo guardar en el dispositivo', e);
      this.emit();
    });
    kickSync();
    return this.chain;
  }

  private emit() { this.version++; this.listeners.forEach((l) => l()); }

  /** Modifica el estado y lo guarda de inmediato en el dispositivo. */
  update(mut: (s: any) => void): Promise<void> {
    this.tick();
    mut(this.state);
    const p = this.persist();
    this.emit();
    return p;
  }

  /** Registra una respuesta a un ítem cerrado (el valor queda también en la bitácora). */
  answer(key: string, value: any, opts: { item?: string; path?: (s: any) => any; logValue?: boolean } = {}) {
    const item = opts.item ?? key;
    this.update((s) => {
      const target = opts.path ? opts.path(s) : s.answers;
      const had = target[key] !== undefined && target[key] !== null;
      target[key] = value;
      const t = this.timing(item);
      if (t.first_ms === undefined) t.first_ms = t.ms;
      if (had) t.changes = (t.changes ?? 0) + 1;
    });
    this.event('answer', item, opts.logValue === false ? { key } : { key, value });
  }

  private timing(id: string) {
    return (this.state.timings[id] ??= { ms: 0, visits: 0, changes: 0, first_shown: iso() });
  }

  /** Acumula el tiempo transcurrido en la pantalla actual. */
  tick() {
    if (!this.cur) return;
    const now = performance.now();
    if (!Number.isNaN(this.cur.t0)) this.timing(this.cur.id).ms += Math.round(now - this.cur.t0);
    this.cur.t0 = now;
  }

  enter(id: string) {
    if (this.cur?.id === id) return;
    this.leave();
    this.cur = { id, t0: performance.now() };
    this.timing(id).visits += 1;
    this.state.cursor = id;
    this.event('screen_enter', id);
    this.persist();
  }

  leave() {
    if (!this.cur) return;
    this.tick();
    const id = this.cur.id;
    this.cur = null;
    this.event('screen_leave', id, { ms: this.state.timings[id]?.ms });
    this.persist();
  }

  /** El tiempo no corre mientras la aplicación está en segundo plano. */
  setVisible(visible: boolean) {
    if (!this.cur) return;
    if (!visible) { this.tick(); this.event('app_oculta', this.cur.id); this.persist(); this.cur.t0 = NaN; }
    else { this.cur.t0 = performance.now(); this.event('app_visible', this.cur.id); }
  }

  event(type: string, item?: string, data?: any) {
    const seq = ++this.seq;
    db.events.add({ surveyId: this.state.id, seq, t: iso(), type, item, data, synced: 0 }).catch((e) => {
      this.saveError = String(e?.message ?? e);
      this.emit();
    });
  }

  /** Espera a que todo lo pendiente esté escrito en el dispositivo. */
  flush() { return this.chain; }
}

export const uid = shortId;
