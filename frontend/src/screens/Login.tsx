import { useState } from 'react';
import { api, setSession } from '../lib/api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { setSession(await api('/auth/login', { json: { email, password } })); }
    catch (x: any) { setErr(x.status === 0 ? 'Para iniciar sesión se necesita conexión a internet.' : x.message); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100%', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', alignItems: 'stretch' }} className="loginGrid">
      <div style={{ background: 'var(--ink)', color: '#fff', padding: '8vh 6vw', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 40 }}>
        <svg viewBox="0 0 400 300" style={{ width: '100%', maxWidth: 460 }} aria-hidden="true">
          <path d="M196 24c-78 6-164 58-170 132-6 80 72 124 168 122 104-2 186-48 180-136S278 18 196 24z" fill="#6747b8" fillOpacity=".3" stroke="#a892e6" strokeWidth="3" />
          <path d="M206 96c-40 2-82 24-84 62-2 36 34 58 82 56 50-2 86-26 82-64s-40-56-80-54z" fill="#0e7c6b" fillOpacity=".55" stroke="#63d1bd" strokeWidth="3" />
          <circle cx="204" cy="158" r="11" fill="#fff" />
        </svg>
        <div>
          <h1 style={{ fontSize: '2.6rem' }}>Encuesta de Díadas</h1>
          <p style={{ marginTop: 14, fontSize: '1.2rem', opacity: 0.85, maxWidth: 440 }}>El barrio caminable de personas con síndrome de Down en Santiago, dibujado por quienes lo recorren y por quienes los acompañan.</p>
          <p style={{ marginTop: 26, opacity: 0.6, fontSize: '.9rem' }}>Del umbral universal a la proximidad relacional. Tesis doctoral, Pontificia Universidad Católica de Chile.</p>
        </div>
      </div>
      <form onSubmit={submit} style={{ padding: '8vh 6vw', display: 'flex', flexDirection: 'column', gap: 18, justifyContent: 'center', maxWidth: 520 }}>
        <h2>Iniciar sesión</h2>
        <div><label className="lbl" htmlFor="email">Correo</label><input id="email" className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="lbl" htmlFor="pw">Clave de acceso</label><input id="pw" className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Entrando' : 'Entrar'}</button>
        <p className="muted small">Los encuestadores reciben su clave del investigador responsable.</p>
      </form>
      <style>{'@media (max-width: 800px) { .loginGrid { grid-template-columns: 1fr !important; } }'}</style>
    </div>
  );
}
