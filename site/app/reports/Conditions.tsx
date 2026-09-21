import { Table } from '../components/Table.tsx';
import { readingName } from '../../reports/presentation.ts';
import { reportCopy } from '../../reports/copy.ts';
import { formatValue } from '../../reports/metrics.ts';
import type { ReportRecord } from '../types/reports.ts';
import type { Locale } from '../../content/locale.ts';

interface ConditionsProps {
  a: ReportRecord;
  b?: ReportRecord | null;
  locale: Locale;
}

const FIELDS: [string, string, string, string?][] = [
  ['frames', 'Measured frames', 'Images mesurées', ''],
  ['warmup', 'Warm-up frames', 'Images de préchauffage', ''],
  ['movingCamera', 'Moving camera', 'Caméra mobile'],
  ['sun', 'Sun', 'Soleil'],
  ['lights', 'Additional lights', 'Lumières supplémentaires', ''],
  ['lightShadows', 'Shadows enabled', 'Ombres activées'],
  ['bounce', 'Indirect lighting', 'Éclairage indirect'],
  ['temporalAntialiasing', 'Temporal antialiasing', 'Anticrénelage temporel'],
  ['stageProfile', 'Profiling enabled', 'Profilage activé'],
  ['visible', 'Visible browser window', 'Fenêtre du navigateur visible'],
  ['shadowBudgetMs', 'Shadow budget', 'Budget des ombres', 'ms'],
  ['geometryPoolBytes', 'Geometry pool budget', 'Budget du pool géométrique', 'MiB'],
  ['texturePoolBytes', 'Texture pool budget', 'Budget du pool de textures', 'MiB'],
];

export function Conditions({ a, b, locale }: ConditionsProps) {
  const c = reportCopy(locale),
    fr = locale === 'fr';
  const value = (record: ReportRecord | null | undefined, key: string, unit?: string) => {
    const raw = record?.settings?.[key];
    if (typeof raw === 'boolean') return raw ? (fr ? 'Oui' : 'Yes') : fr ? 'Non' : 'No';
    if (typeof raw !== 'number') return c.unknown;
    return formatValue(unit === 'MiB' ? raw / 1048576 : raw, locale, unit);
  };
  return (
    <section className="grid min-w-0 gap-3">
      <h3 className="text-lg font-semibold">{c.protocol}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{c.protocol}</th>
            <th scope="col">{readingName(a, locale)}</th>
            {b && <th scope="col">{readingName(b, locale)}</th>}
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(([key, en, translated, unit]) => (
            <tr key={key}>
              <th scope="row">{fr ? translated : en}</th>
              <td>{value(a, key, unit)}</td>
              {b && <td>{value(b, key, unit)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
