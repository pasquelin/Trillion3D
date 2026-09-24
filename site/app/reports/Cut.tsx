import { useWords } from '../i18n.ts';
import { Section } from '../ui/Text.tsx';
import { Table } from '../ui/Table.tsx';
import { formatValue } from '../../reports/metrics.ts';
import type { CutAnalysis, CutRow } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface CutProps {
  analysis?: CutAnalysis;
  locale: Locale;
}

export function Cut({ analysis, locale }: CutProps) {
  const t = useWords(locale);
  if (!analysis) return null;
  const tables: [string, CutRow[]][] = [
    ['Primitive', analysis.byPrimitive],
    ['DAG', analysis.byLevel],
  ];
  return (
    <Section level={3} title={t('report.cutTitle')}>
      <p>
        {formatValue(analysis.total, locale)} {t('report.cutUnknown')} {analysis.unknown}
      </p>
      <p className="text-sm leading-relaxed text-base-content/75">{t('report.cutNote')}</p>
      {tables.map(([label, rows]) => (
        <Table key={label}>
          <thead>
            <tr>
              <th scope="col">{label}</th>
              <th scope="col">Triangles</th>
              <th scope="col">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{formatValue(row.triangles, locale)}</td>
                <td>
                  {formatValue(
                    analysis.total ? (row.triangles / analysis.total) * 100 : null,
                    locale,
                    '%',
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ))}
    </Section>
  );
}
