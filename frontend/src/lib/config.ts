import { useEffect, useState } from 'react';
import { api } from './api';
import { kvGet, kvSet } from './db';

export type AppConfig = { mapbox_token: string; settings: any; target_n: number };
let cached: AppConfig | null = null;

/** Configuración del estudio: se pide al servidor y se guarda en el tablet para trabajar sin conexión. */
export async function loadConfig(force = false): Promise<AppConfig | null> {
  if (cached && !force) return cached;
  try {
    const c = await api<AppConfig>('/config', { timeout: 8000 });
    cached = c;
    await kvSet('config', c);
  } catch {
    cached = cached ?? (await kvGet<AppConfig>('config')) ?? null;
  }
  return cached;
}

export function useConfig(): AppConfig | null {
  const [c, setC] = useState<AppConfig | null>(cached);
  useEffect(() => { let on = true; loadConfig(true).then((x) => on && setC(x)); return () => { on = false; }; }, []);
  return c;
}
