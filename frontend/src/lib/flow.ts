import { ITEMS } from './instrument';

export type Step = { id: string; block: string; kind: string; item?: string; dest?: string; who?: 'encuestador' | 'cuidador' | 'persona' };

export const soloDests = (a: any) => (a.destinos as any[]).filter((d) => d.C5 === 3 || d.C5 === 4);
export const filterFailed = (a: any) => [a.A1a, a.A1b, a.A1c].some((v) => v === 0);

/** Secuencia de pantallas de la encuesta, según lo respondido hasta ahora. */
export function computeSteps(state: any): Step[] {
  const a = state.answers;
  const t = state.config.tareas;
  const steps: Step[] = [];
  const add = (id: string, block: string, kind: string, extra: Partial<Step> = {}) => steps.push({ id, block, kind, ...extra });
  const q = (item: string) => add(item, ITEMS[item].block, 'item', { item });

  add('consentimiento.cuidador', 'inicio', 'consentCuidador');
  if (state.consent?.cuidador?.acepta === false) { add('cierre', 'cierre', 'cierre'); return steps; }
  for (const k of ['A1a', 'A1b', 'A1c']) {
    q(k);
    if (a[k] === 0) { add('cierre', 'cierre', 'cierre'); return steps; } // el filtro termina la encuesta en el primer No
  }
  add('A2', 'A', 'A2');
  q('A3');
  add('A4', 'A', 'A4');

  add('B.intro', 'B', 'intro');
  add('B1', 'B', 'poligono', { who: 'cuidador' });
  add('B2', 'B', 'poligono', { who: 'cuidador' });
  if (t.B3) add('B3', 'B', 'preocupaciones', { who: 'cuidador' });

  add('C.intro', 'C', 'intro');
  for (const d of a.destinos as any[]) {
    add(`C.${d.id}.C1`, 'C', 'destNombre', { dest: d.id });
    add(`C.${d.id}.C3`, 'C', 'destMapa', { dest: d.id });
    for (const it of ['C4', 'C5', 'C6']) add(`C.${d.id}.${it}`, 'C', 'item', { item: it, dest: d.id });
  }
  add('C.lista', 'C', 'destLista');
  const solos = soloDests(a);
  if (solos.length >= 2) {
    add('C7', 'C', 'orden');
    if (t.C8) add('C8', 'C', 'orden');
    if (t.C9) add('C9', 'C', 'orden');
  }
  if (t.C10) for (const d of solos) add(`C10.${d.id}`, 'C', 'ruta', { dest: d.id, who: 'cuidador' });

  add('D.intro', 'D', 'intro');
  ['D1', 'D2', 'D3', 'D4'].forEach(q);
  add('E.intro', 'E', 'intro');
  (a.E_orden as string[]).forEach(q);
  q('E7');
  add('F.intro', 'F', 'intro');
  (a.F_orden as string[]).forEach(q);
  ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].forEach(q);
  ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11'].forEach(q);
  if (a.H11 === 1) q('H11r');

  add('P.aplica', 'P', 'pAplica');
  const p = a.P ?? {};
  if (p.aplicado === 1 || p.via_consentimiento) {
    add('consentimiento.persona', 'P', 'consentPersona');
    const c = state.consent?.persona;
    if (p.aplicado === 1 && c?.acepta === true && c?.comprension === true) {
      add('P.preparacion', 'P', 'pPrep');
      add('P1a', 'P', 'pAbierta', { who: 'persona' });
      add('P1b', 'P', 'pAbierta', { who: 'persona' });
      add('P.intro', 'P', 'intro', { who: 'persona' });
      for (const b of ['P2', 'P3', 'P4']) {
        add(b, 'P', 'pTablero', { who: 'persona' });
        if (p.detenido && p.detenido_en === b) break;
      }
    }
  }
  add('cierre', 'cierre', 'cierre');
  return steps;
}

const answered = (v: any) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

/** ¿La pantalla tiene lo necesario para avanzar? */
export function stepComplete(step: Step, state: any): boolean {
  const a = state.answers, g = state.geo;
  const dest = step.dest ? (a.destinos as any[]).find((d) => d.id === step.dest) : null;
  switch (step.kind) {
    case 'consentCuidador': { const c = state.consent?.cuidador; return !!c && c.acepta !== undefined && c.audio !== undefined && (c.acepta === false || c.modo === 'papel' || !!g.firmas?.cuidador); }
    case 'item': return answered((dest ?? a)[step.item!]);
    case 'A2': return !!g.nombre?.trim() && !!a.tratamiento;
    case 'A4': return !!g.direccion?.trim() && g.home?.lng != null && !!a.comuna;
    case 'poligono': return !!a[`${step.id}_estado`];
    case 'preocupaciones': return !!a.B3_estado;
    case 'destNombre': return !!g.destinos?.[step.dest!]?.nombre?.trim() && answered(dest?.C2);
    case 'destMapa': return g.destinos?.[step.dest!]?.lng != null || dest?.C3_estado === 'omitido';
    case 'destLista': return a.destinos.length > 0 || a.C_sin_destinos === true;
    case 'orden': return (a[step.id] ?? []).length === soloDests(a).length;
    case 'ruta': return !!dest?.C10_estado && (dest.C10_estado === 'omitida' || dest.C10_alt !== undefined);
    case 'pAplica': { const p = a.P ?? {}; return p.aplicado === 1 || (p.aplicado === 0 && !!p.razon); }
    case 'consentPersona': { const c = state.consent?.persona; return !!c?.modo && c.comprension !== undefined && (c.comprension === false || c.acepta !== undefined); }
    case 'pPrep': { const p = a.P ?? {}; return !!p.variante && (p.control ?? []).length >= 1 && p.separado !== undefined; }
    case 'pAbierta': return a.P?.[step.id] !== undefined;
    case 'pTablero': return a.P?.[`${step.id}_listo`] === true || a.P?.detenido === true;
    default: return true;
  }
}
