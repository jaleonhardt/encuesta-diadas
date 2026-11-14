import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { getSession } from './lib/api';
import { startSync } from './lib/sync';
import Home from './screens/Home';
import Login from './screens/Login';
import Runner from './screens/Runner';
import './styles.css';

const Admin = lazy(() => import('./admin/Admin'));

let applyUpdate = () => {};
let notifyUpdate = () => {};
if (import.meta.env.PROD) {
  const update = registerSW({ onNeedRefresh: () => notifyUpdate() });
  applyUpdate = () => update(true);
}

function App() {
  const [session, setS] = useState(getSession());
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    const h = () => setS(getSession());
    window.addEventListener('diadas-session', h);
    notifyUpdate = () => setUpdateReady(true);
    return () => window.removeEventListener('diadas-session', h);
  }, []);
  useEffect(() => { if (session) startSync(); }, [session]);
  if (!session) return <Login />;
  return (
    <Routes>
      <Route path="/" element={<Home updateReady={updateReady} applyUpdate={applyUpdate} />} />
      <Route path="/encuesta/:id" element={<Runner />} />
      <Route path="/admin/*" element={session.role === 'admin' ? <Suspense fallback={<div className="page">Cargando</div>}><Admin /></Suspense> : <Navigate to="/" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(<BrowserRouter><App /></BrowserRouter>);
