import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { simplify, type XY } from '../lib/geom';

export const MAP_STYLES = [
  { id: 'calles', label: 'Calles', url: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'claro', label: 'Claro', url: 'mapbox://styles/mapbox/light-v11' },
  { id: 'satelite', label: 'Satélite con calles', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'relieve', label: 'Parques y relieve', url: 'mapbox://styles/mapbox/outdoors-v12' },
];
const STYLE_KEY = 'diadas.estilo';
export const SANTIAGO: XY = [-70.6506, -33.4372];

export type Tool = null | 'area-libre' | 'area-puntos' | 'linea-libre' | 'punto';
export type DrawResult = { geometry: any; trazo?: XY[]; ms: number; modo: string; n_trazo: number };
export type Marker = { id: string; lng: number; lat: number; kind: 'home' | 'dest'; label?: string; dim?: boolean };
export type MapHandle = { flyTo: (c: XY, zoom?: number) => void; fit: (b: [XY, XY]) => void; info: () => { zoom: number; estilo: string }; undoVertex: () => void; closeVertices: () => void; vertexCount: () => number };

type Props = {
  token: string; center: XY; zoom?: number; features?: any[]; markers?: Marker[]; tool: Tool;
  onDrawStart?: () => void; onDrawn?: (r: DrawResult) => void; onTooShort?: () => void;
  onStyle?: (id: string, inicial: boolean) => void; onView?: (zoom: number) => void; onVertices?: (n: number) => void;
  children?: ReactNode; interactive?: boolean;
};

const COLORS = ['match', ['get', 'kind'], 'b1', '#0e7c6b', 'b2', '#6747b8', 'ruta', '#0e7c6b', 'tramo', '#c2412d', 'punto', '#c2412d', 'ctx', '#56675f', '#12211e'];

function installLayers(map: mapboxgl.Map) {
  // El instrumento pide red vial visible y sin límites administrativos.
  for (const l of map.getStyle()?.layers ?? []) {
    if (/^admin-/.test(l.id) || l.id.includes('boundary')) map.setLayoutProperty(l.id, 'visibility', 'none');
  }
  for (const id of ['fc', 'draft']) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const add = (l: any) => { if (!map.getLayer(l.id)) map.addLayer(l); };
  add({ id: 'fc-fill', type: 'fill', source: 'fc', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLORS, 'fill-opacity': ['case', ['==', ['get', 'kind'], 'ctx'], 0.06, 0.2] } });
  add({ id: 'fc-casing', type: 'line', source: 'fc', filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 } });
  add({ id: 'fc-line', type: 'line', source: 'fc', filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLORS, 'line-width': 4.5, 'line-dasharray': ['case', ['==', ['get', 'kind'], 'ctx'], ['literal', [1, 1.6]], ['literal', [1, 0]]] } });
  add({ id: 'fc-pt', type: 'circle', source: 'fc', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 11, 'circle-color': COLORS, 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
  add({ id: 'draft-casing', type: 'line', source: 'draft', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 9 } });
  add({ id: 'draft-line', type: 'line', source: 'draft', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#12211e', 'line-width': 5 } });
  add({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 8, 'circle-color': '#12211e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
}

const HOME_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 2.5 11.2h2.7V21h5.3v-6h3v6h5.3v-9.8h2.7z"/></svg>';

export const MapCanvas = forwardRef<MapHandle, Props>(function MapCanvas(p, ref) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [style, setStyle] = useState(() => localStorage.getItem(STYLE_KEY) || 'calles');
  const styleRef = useRef(style);
  const propsRef = useRef(p);
  propsRef.current = p;
  const stroke = useRef<{ pts: XY[]; t0: number; id: number } | null>(null);
  const vertices = useRef<XY[]>([]);
  const vertexT0 = useRef(0);

  const setDraft = (features: any[]) => (mapRef.current?.getSource('draft') as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  const syncData = () => (mapRef.current?.getSource('fc') as mapboxgl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: propsRef.current.features ?? [] });

  useEffect(() => {
    if (!p.token) { setFailed('Falta configurar el token de Mapbox en el servidor.'); return; }
    if (!mapboxgl.supported()) { setFailed('Este dispositivo no puede mostrar el mapa (WebGL no disponible).'); return; }
    mapboxgl.accessToken = p.token;
    const map = new mapboxgl.Map({
      container: box.current!, style: MAP_STYLES.find((s) => s.id === styleRef.current)?.url ?? MAP_STYLES[0].url,
      center: p.center, zoom: p.zoom ?? 15.6, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      attributionControl: false, interactive: p.interactive !== false, maxZoom: 19, minZoom: 9, language: 'es',
    } as any);
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    map.touchZoomRotate.disableRotation();
    map.on('style.load', () => { installLayers(map); syncData(); setReady(true); setFailed(null); });
    map.on('error', (e: any) => { if (!map.isStyleLoaded() && !mapRef.current?.getSource('fc')) setFailed(navigator.onLine ? 'No se pudo cargar el mapa. Revise la conexión y vuelva a intentar.' : 'El mapa necesita conexión a internet para cargar. Las respuestas ya ingresadas están guardadas.'); console.warn('mapa', e?.error?.message); });
    let t: any;
    map.on('moveend', () => { clearTimeout(t); t = setTimeout(() => propsRef.current.onView?.(Math.round(map.getZoom() * 100) / 100), 700); });
    mapRef.current = map;
    propsRef.current.onStyle?.(styleRef.current, true);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(box.current!);
    return () => { ro.disconnect(); clearTimeout(t); markersRef.current.forEach((m) => m.remove()); map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.token]);

  useEffect(() => { if (ready) syncData(); }, [p.features, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = (p.markers ?? []).map((m) => {
      const el = document.createElement('div');
      if (m.kind === 'home') { el.className = 'homepin'; el.innerHTML = HOME_SVG; el.setAttribute('aria-label', 'Casa'); }
      else { el.className = 'destpin' + (m.dim ? ' dim' : ''); el.textContent = m.label ?? ''; }
      return new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([m.lng, m.lat]).addTo(map);
    });
  }, [p.markers, ready]);

  useEffect(() => { vertices.current = []; stroke.current = null; setDraft([]); p.onVertices?.(0); /* al cambiar de herramienta se descarta el borrador */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.tool]);

  const finishVertices = () => {
    const v = vertices.current;
    if (v.length < 3) return;
    const ring = [...v, v[0]];
    vertices.current = []; setDraft([]); p.onVertices?.(0);
    p.onDrawn?.({ geometry: { type: 'Polygon', coordinates: [ring] }, ms: Math.round(performance.now() - vertexT0.current), modo: 'puntos', n_trazo: v.length });
  };
  const drawVertices = () => {
    const v = vertices.current;
    setDraft([...(v.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: v.length > 2 ? [...v, v[0]] : v } }] : []),
      ...v.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } }))]);
    p.onVertices?.(v.length);
  };

  useImperativeHandle(ref, () => ({
    flyTo: (c, zoom) => mapRef.current?.flyTo({ center: c, zoom: zoom ?? mapRef.current.getZoom(), duration: 700 }),
    fit: (b) => mapRef.current?.fitBounds(b, { padding: 90, maxZoom: 17, duration: 600 }),
    info: () => ({ zoom: Math.round((mapRef.current?.getZoom() ?? 0) * 100) / 100, estilo: styleRef.current }),
    undoVertex: () => { vertices.current.pop(); drawVertices(); },
    closeVertices: finishVertices,
    vertexCount: () => vertices.current.length,
  }));

  const changeStyle = (id: string) => {
    setMenu(false);
    if (id === styleRef.current) return;
    styleRef.current = id; setStyle(id); localStorage.setItem(STYLE_KEY, id);
    mapRef.current?.setStyle(MAP_STYLES.find((s) => s.id === id)!.url);
    p.onStyle?.(id, false);
  };

  // --- dibujo con el dedo: se captura en coordenadas de pantalla y se convierte a coordenadas geográficas
  const xy = (e: React.PointerEvent): XY => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toLngLat = (pts: XY[]): XY[] => pts.map((q) => { const l = mapRef.current!.unproject(q); return [Math.round(l.lng * 1e6) / 1e6, Math.round(l.lat * 1e6) / 1e6]; });
  const free = p.tool === 'area-libre' || p.tool === 'linea-libre';

  const down = (e: React.PointerEvent) => {
    if (!mapRef.current || stroke.current) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    stroke.current = { pts: [xy(e)], t0: performance.now(), id: e.pointerId };
    if (free) p.onDrawStart?.();
  };
  const move = (e: React.PointerEvent) => {
    const s = stroke.current;
    if (!s || s.id !== e.pointerId || !free) return;
    const q = xy(e), last = s.pts[s.pts.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) < 3) return;
    s.pts.push(q);
    setDraft([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: toLngLat(s.pts) } }]);
  };
  const up = (e: React.PointerEvent) => {
    const s = stroke.current;
    if (!s || s.id !== e.pointerId) return;
    stroke.current = null;
    const ms = Math.round(performance.now() - s.t0);
    if (p.tool === 'punto') { const [c] = toLngLat([xy(e)]); p.onDrawn?.({ geometry: { type: 'Point', coordinates: c }, ms, modo: 'toque', n_trazo: 1 }); return; }
    if (p.tool === 'area-puntos') {
      if (!vertices.current.length) { vertexT0.current = performance.now(); p.onDrawStart?.(); }
      vertices.current.push(toLngLat([xy(e)])[0]); drawVertices(); return;
    }
    let len = 0;
    for (let i = 1; i < s.pts.length; i++) len += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
    setDraft([]);
    if (s.pts.length < 6 || len < 60) { p.onTooShort?.(); return; }
    const trazo = toLngLat(s.pts);
    const simple = toLngLat(simplify(s.pts, 2.5));
    if (p.tool === 'area-libre') {
      if (simple.length < 3) { p.onTooShort?.(); return; }
      p.onDrawn?.({ geometry: { type: 'Polygon', coordinates: [[...simple, simple[0]]] }, trazo, ms, modo: 'libre', n_trazo: s.pts.length });
    } else {
      p.onDrawn?.({ geometry: { type: 'LineString', coordinates: simple }, trazo, ms, modo: 'libre', n_trazo: s.pts.length });
    }
  };

  return (
    <div className="mapwrap">
      <div ref={box} className="map" />
      {failed && <div className="mapfail"><div className="notice bad" style={{ maxWidth: 460 }}>{failed}</div></div>}
      {p.tool && ready && <div className="drawlayer" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { stroke.current = null; setDraft([]); }} />}
      {p.interactive !== false && (
        <div className="maptools">
          <button type="button" className="maptool" aria-label="Cambiar el estilo del mapa" onClick={() => setMenu((m) => !m)}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></svg>
          </button>
          <button type="button" className="maptool" aria-label="Acercar" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" className="maptool" aria-label="Alejar" onClick={() => mapRef.current?.zoomOut()}>−</button>
          <button type="button" className="maptool" aria-label="Volver a la casa" onClick={() => mapRef.current?.flyTo({ center: p.center, duration: 600 })}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2.5 11.2h2.7V21h5.3v-6h3v6h5.3v-9.8h2.7z" /></svg>
          </button>
        </div>
      )}
      {menu && (
        <div className="stylemenu" role="menu">
          {MAP_STYLES.map((s) => <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => changeStyle(s.id)}>{s.label}</button>)}
        </div>
      )}
      {p.children}
    </div>
  );
});
