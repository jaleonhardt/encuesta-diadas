import raw from '../../../shared/instrument.json';

export type Opt = { code: number; label: string; hint?: string; key?: string };
export type Item = {
  block: string; type: 'single' | 'multi' | 'number'; text: string; label: string; help?: string;
  scale?: string; options?: Opt[]; otherCode?: number; exclusiveCode?: number; latent?: string; sense?: number;
  reserve?: boolean; perDestination?: boolean; min?: number; max?: number; unit?: string;
  showIf?: { item: string; equals: number };
};
export const INSTRUMENT = raw as any;
export const ITEMS = raw.items as unknown as Record<string, Item>;
export const BLOCKS = raw.blocks as { id: string; titulo: string; minutos: number }[];
export const PMOD = raw.P as any;
export const NS = -88;
export const NR = -99;

export const optionsOf = (it: Item): Opt[] => it.options ?? (raw.scales as any)[it.scale!];

export type Trat = 'm' | 'f' | undefined;

/** Sustituye [NOMBRE] y las marcas {masculino|femenino|sin definir}. */
export function tx(text: string, nombre?: string, trat?: Trat): string {
  return text
    .replace(/\{([^|}]*)\|([^|}]*)\|([^}]*)\}/g, (_, m, f, n) => (trat === 'm' ? m : trat === 'f' ? f : n))
    .replace(/\[NOMBRE\]/g, nombre?.trim() || 'la persona');
}

export const COMUNAS = [
  'Cerrillos', 'Cerro Navia', 'Colina', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'Independencia',
  'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Lampa', 'Las Condes', 'Lo Barnechea', 'Lo Espejo',
  'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Padre Hurtado', 'Pedro Aguirre Cerda', 'Peñalolén', 'Pirque', 'Providencia',
  'Pudahuel', 'Puente Alto', 'Quilicura', 'Quinta Normal', 'Recoleta', 'Renca', 'San Bernardo', 'San Joaquín',
  'San José de Maipo', 'San Miguel', 'San Ramón', 'Santiago', 'Vitacura',
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Busca una comuna del Gran Santiago entre los nombres que entrega el geocodificador. */
export function matchComuna(names: (string | undefined)[]): string | undefined {
  const table = new Map(COMUNAS.map((c) => [norm(c), c]));
  for (const n of names) {
    if (n && table.has(norm(n))) return table.get(norm(n));
  }
  return undefined;
}
