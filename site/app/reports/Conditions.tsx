import { useWords } from '../i18n.ts';
import { Table } from '../ui/Table.tsx';
import { readingName } from '../../reports/presentation.ts';
import { formatValue } from '../../reports/metrics.ts';
import type { ReportRecord } from '../../reports/types.ts';
import type { Dictionary } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';

interface ConditionsProps {
  a: ReportRecord;
  b?: ReportRecord | null;
  locale: Locale;
}

/** The settings a reading states, each named by `conditions.<key>`, with its unit. */
const FIELDS: [keyof Dictionary['conditions'], string?][] = [
  ['frames', ''],
  ['warmup', ''],
  ['movingCamera'],
  ['sun'],
  ['lights', ''],
  ['lightShadows'],
  ['bounce'],
  ['temporalAntialiasing'],
  ['stageProfile'],
  ['visible'],
  ['shadowBudgetMs', 'ms'],
  ['geometryPoolBytes', 'MiB'],
  ['texturePoolBytes', 'MiB'],
];

export function Conditions({ a, b, locale }: ConditionsProps) {
  const t = useWords(locale);
  const value = (record: ReportRecord | null | undefined, key: string, unit?: string) => {
    const raw = record?.settings?.[key];
    if (typeof raw === 'boolean') return t(raw ? 'report.yes' : 'report.no');
    if (typeof raw !== 'number') return t('report.unknown');
    return formatValue(unit === 'MiB' ? raw / 1048576 : raw, locale, unit);
  };
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3">
      <h3 className="text-lg font-semibold">{t('report.protocol')}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t('report.protocol')}</th>
            <th scope="col">{readingName(a, locale)}</th>
            {b && <th scope="col">{readingName(b, locale)}</th>}
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(([key, unit]) => (
            <tr key={key}>
              <th scope="row">{t(`conditions.${key}`)}</th>
              <td>{value(a, key, unit)}</td>
              {b && <td>{value(b, key, unit)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
