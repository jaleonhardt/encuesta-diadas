import Dexie, { type Table } from 'dexie';

export type SurveyRow = {
  id: string; state: any; rev: number; syncedRev: number; status: string; updatedAt: number;
  serverDeleted?: boolean; lastSyncAt?: number; owner: string;
};
export type EventRow = { lid?: number; surveyId: string; seq: number; t: string; type: string; item?: string; data?: any; synced: 0 | 1 };
export type AudioRow = { surveyId: string; segment: number; seq: number; mime: string; data: ArrayBuffer; size: number; synced: 0 | 1 };

class DiadasDB extends Dexie {
  surveys!: Table<SurveyRow, string>;
  events!: Table<EventRow, number>;
  audio!: Table<AudioRow, [string, number, number]>;
  kv!: Table<{ key: string; value: any }, string>;
  constructor() {
    super('encuesta-diadas');
    this.version(1).stores({
      surveys: 'id, status, updatedAt, owner',
      events: '++lid, surveyId, [surveyId+synced], [surveyId+seq]',
      audio: '[surveyId+segment+seq], surveyId, [surveyId+synced]',
      kv: 'key',
    });
  }
}
export const db = new DiadasDB();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value;
}
export const kvSet = (key: string, value: any) => db.kv.put({ key, value });

/** Pide al navegador que no borre los datos locales aunque falte espacio. */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
