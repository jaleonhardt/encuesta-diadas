import { describe, expect, it } from 'vitest';
import { computeSteps, stepComplete } from './flow';
import { haversine, pointInRing, ringArea, selfIntersects, simplify, type XY } from './geom';
import { matchComuna, tx } from './instrument';

describe('geometría', () => {
  it('simplifica sin perder las esquinas', () => {
    const pts: XY[] = [];
    for (let i = 0; i <= 100; i++) pts.push([i, 0]);
    for (let i = 1; i <= 100; i++) pts.push([100, i]);
    expect(simplify(pts, 2)).toEqual([[0, 0], [100, 0], [100, 100]]);
  });
  it('mide áreas y distancias', () => {
    const d = 0.01;
    const ring: XY[] = [[-70.6, -33.45], [-70.6 + d, -33.45], [-70.6 + d, -33.45 + d], [-70.6, -33.45 + d], [-70.6, -33.45]];
    expect(ringArea(ring) / 1e6).toBeCloseTo(1.03, 1);
    expect(haversine([-70.6, -33.45], [-70.6, -33.44])).toBeCloseTo(1112, -1);
    expect(pointInRing([-70.595, -33.445], ring)).toBe(true);
    expect(pointInRing([-70.5, -33.445], ring)).toBe(false);
  });
  it('detecta un trazo que se cruza', () => {
    expect(selfIntersects([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]])).toBe(true);
    expect(selfIntersects([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]])).toBe(false);
  });
});

describe('instrumento', () => {
  it('personaliza el texto', () => {
    const t = 'Prefiero que [NOMBRE] vaya {solo|sola|solo} y {lo|la|lo} esperen';
    expect(tx(t, 'Antonia', 'f')).toBe('Prefiero que Antonia vaya sola y la esperen');
    expect(tx(t, 'Pedro', 'm')).toBe('Prefiero que Pedro vaya solo y lo esperen');
  });
  it('reconoce comunas', () => {
    expect(matchComuna(['Región Metropolitana', 'nunoa'])).toBe('Ñuñoa');
    expect(matchComuna(['Valparaíso'])).toBeUndefined();
  });
});

describe('flujo', () => {
  const base = () => ({
    config: { tareas: { B3: true, C8: true, C9: true, C10: true } }, consent: { cuidador: { acepta: true, audio: true, modo: 'papel' } },
    answers: { A1a: 1, A1b: 1, A1c: 1, destinos: [] as any[], E_orden: ['E2', 'E1'], F_orden: ['F1'], P: {} as any }, geo: { destinos: {}, firmas: {} },
  });
  it('termina en el filtro', () => {
    const s = base(); s.answers.A1b = 0;
    expect(computeSteps(s).map((x) => x.id)).toEqual(['consentimiento.cuidador', 'A1a', 'A1b', 'cierre']);
  });
  it('aplica órdenes y rutas solo a destinos sin compañía', () => {
    const s = base();
    s.answers.destinos = [{ id: 'a', C5: 4 }, { id: 'b', C5: 1 }];
    let ids = computeSteps(s).map((x) => x.id);
    expect(ids).toContain('C10.a'); expect(ids).not.toContain('C10.b'); expect(ids).not.toContain('C7');
    s.answers.destinos.push({ id: 'c', C5: 3 });
    s.config.tareas.C9 = false;
    ids = computeSteps(s).map((x) => x.id);
    expect(ids).toContain('C7'); expect(ids).toContain('C8'); expect(ids).not.toContain('C9');
    expect(ids.indexOf('E2')).toBeLessThan(ids.indexOf('E1'));
  });
  it('el módulo P exige consentimiento de la persona', () => {
    const s: any = base();
    s.answers.P = { aplicado: 1 };
    expect(computeSteps(s).map((x) => x.id)).not.toContain('P3');
    s.consent.persona = { acepta: true, comprension: true, modo: 'papel' };
    expect(computeSteps(s).map((x) => x.id)).toContain('P3');
    s.answers.P = { aplicado: 1, detenido: true, detenido_en: 'P3' };
    expect(computeSteps(s).map((x) => x.id)).not.toContain('P4');
    s.answers.P = { aplicado: 0, razon: 2, via_consentimiento: true };
    const ids = computeSteps(s).map((x) => x.id);
    expect(ids).toContain('consentimiento.persona'); expect(ids).not.toContain('P1a');
    expect(stepComplete({ id: 'B1', block: 'B', kind: 'poligono' }, s)).toBe(false);
  });
});
