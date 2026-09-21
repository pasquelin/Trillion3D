import type { ReactElement } from 'react';
import { engineTone } from '../../js/reports/assessment.js';
import { engineName } from '../../js/reports/names.js';
import { StatusBadge } from '../components/StatusBadge.tsx';
import type { Locale } from '../types/portal.ts';

export interface ReadingLegendProps {
  locale: Locale;
  engines?: boolean;
}

export function ReadingLegend({ locale, engines = false }: ReadingLegendProps): ReactElement {
  const fr = locale === 'fr';
  if (engines)
    return (
      <div className="grid gap-2 text-sm">
        <div className="flex flex-wrap gap-2">
          {['three-nu', 'three-lod', 'webgpu-page-raster'].map((engine) => (
            <StatusBadge key={engine} tone={engineTone(engine)}>
              {engineName(engine)}
            </StatusBadge>
          ))}
        </div>
        <p>
          {fr
            ? 'Chaque moteur garde sa couleur dans tous les graphiques. Pour les durées, une barre plus courte signifie moins de temps.'
            : 'Each engine keeps its color across all charts. For durations, a shorter bar means less time.'}
        </p>
      </div>
    );
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone="success">{fr ? 'Vert : ≤ 13,33 ms' : 'Green: ≤ 13.33 ms'}</StatusBadge>
        <StatusBadge tone="warning">{fr ? 'Jaune : ≤ 16,67 ms' : 'Yellow: ≤ 16.67 ms'}</StatusBadge>
        <StatusBadge tone="error">{fr ? 'Rouge : > 16,67 ms' : 'Red: > 16.67 ms'}</StatusBadge>
      </div>
      <p>
        {fr
          ? 'Couleurs des durées CPU / GPU / rendu synchronisé : marge de 20 %, proche du budget, budget dépassé. Repère de 60 images/s, pas une mesure de FPS. Les quantités sans objectif chiffré restent neutres.'
          : 'CPU / GPU / synchronized-render timing colors: 20% headroom, near budget, over budget. A 60 fps target marker, not measured FPS. Quantities without a numerical target stay neutral.'}
      </p>
    </div>
  );
}
