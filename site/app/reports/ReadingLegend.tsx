import { useWords } from '../i18n.ts';
import { engineTone } from '../../reports/assessment.ts';
import { engineName } from '../../reports/names.ts';
import { Badge } from '../ui/Badge.tsx';
import type { Locale } from '../../content/locale.ts';

interface ReadingLegendProps {
  locale: Locale;
  engines?: boolean;
}

export function ReadingLegend({ locale, engines = false }: ReadingLegendProps) {
  const t = useWords(locale);
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
        <p>{t('report.engineColors')}</p>
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge size="sm" tone="success">
          {t('report.green')}
        </Badge>
        <Badge size="sm" tone="warning">
          {t('report.yellow')}
        </Badge>
        <Badge size="sm" tone="error">
          {t('report.red')}
        </Badge>
      </div>
      <p>{t('report.timingColors')}</p>
    </div>
  );
}
