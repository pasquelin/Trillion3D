import { engineTone } from '../../reports/assessment.ts';
import { engineName } from '../../reports/names.ts';
import { Badge } from '../ui/Badge.tsx';
import type { Locale } from '../../content/locale.ts';

interface ReadingLegendProps {
  locale: Locale;
  engines?: boolean;
}

export function ReadingLegend({ locale, engines = false }: ReadingLegendProps) {
  const fr = locale === 'fr';
  if (engines)
    return (
      <div className="grid grid-cols-1 gap-2 text-sm">
        <div className="flex flex-wrap gap-2">
          {['three-nu', 'three-lod', 'webgpu-page-raster'].map((engine) => (
            <Badge size="sm" key={engine} tone={engineTone(engine)}>
              {engineName(engine)}
            </Badge>
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
    <div className="grid grid-cols-1 gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge size="sm" tone="success">
          {fr ? 'Vert : ≤ 13,33 ms' : 'Green: ≤ 13.33 ms'}
        </Badge>
        <Badge size="sm" tone="warning">
          {fr ? 'Jaune : ≤ 16,67 ms' : 'Yellow: ≤ 16.67 ms'}
        </Badge>
        <Badge size="sm" tone="error">
          {fr ? 'Rouge : > 16,67 ms' : 'Red: > 16.67 ms'}
        </Badge>
      </div>
      <p>
        {fr
          ? 'Couleurs des durées CPU / GPU / rendu synchronisé : marge de 20 %, proche du budget, budget dépassé. Repère de 60 images/s, pas une mesure de FPS. Les quantités sans objectif chiffré restent neutres.'
          : 'CPU / GPU / synchronized-render timing colors: 20% headroom, near budget, over budget. A 60 fps target marker, not measured FPS. Quantities without a numerical target stay neutral.'}
      </p>
    </div>
  );
}
