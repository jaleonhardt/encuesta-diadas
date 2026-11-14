export type Session = { token: string; role: 'admin' | 'interviewer'; email: string; name: string };
const KEY = 'diadas.session';

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setSession(s: Session | null) {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event('diadas-session'));
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; json?: any; body?: BodyInit; headers?: Record<string, string>; timeout?: number; raw?: boolean } = {}): Promise<T> {
  const s = getSession();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30000);
  try {
    const res = await fetch('/api' + path, {
      method: opts.method ?? (opts.json !== undefined || opts.body ? 'POST' : 'GET'),
      headers: {
        ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(s ? { Authorization: 'Bearer ' + s.token } : {}),
        ...opts.headers,
      },
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).detail ?? msg; } catch { /* sin cuerpo */ }
      throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return (opts.raw ? res : await res.json()) as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, 'Sin conexión con el servidor');
  } finally {
    clearTimeout(timer);
  }
}
