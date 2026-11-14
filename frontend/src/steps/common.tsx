import type { Step } from '../lib/flow';
import { tx, type Trat } from '../lib/instrument';
import type { SurveySession } from '../lib/store';

export type StepProps = {
  session: SurveySession; state: any; step: Step; token: string; settings: any;
  next: () => void; goTo: (id: string) => void;
};

export const nombreDe = (state: any): string => state.geo?.nombre ?? '';
export const tratDe = (state: any): Trat => state.answers?.tratamiento;
export const T = (state: any, text: string) => tx(text, nombreDe(state), tratDe(state));

/** Registro de lo que ocurre con el mapa en una tarea: estilo visible, cambios de estilo y nivel de zoom. */
export function mapLog(session: SurveySession, item: string) {
  return {
    onStyle: (estilo: string, inicial: boolean) => {
      const m = session.state.mapas[item];
      if (m?.estilo === estilo) return;
      session.update((s) => {
        const r = (s.mapas[item] ??= {});
        r.estilo = estilo;
        r.estilos_usados = [...new Set([...(r.estilos_usados ?? []), estilo])];
        if (!inicial) r.cambios_estilo = (r.cambios_estilo ?? 0) + 1;
      });
      session.event(inicial ? 'map_style_inicial' : 'map_style_cambio', item, { estilo });
    },
    onView: (zoom: number) => session.event('map_view', item, { zoom }),
  };
}

export const homeOf = (state: any): [number, number] | null => (state.geo?.home?.lng != null ? [state.geo.home.lng, state.geo.home.lat] : null);
