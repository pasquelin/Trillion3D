import { Table } from '../components/Table.tsx';
import { formatValue } from '../../reports/metrics.ts';
import type { CutAnalysis, CutRow } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface CutProps {
  analysis?: CutAnalysis;
  locale: Locale;
}

export function Cut({ analysis, locale }: CutProps) {
  if (!analysis) return null;
  const fr = locale === 'fr';
  const tables: [string, CutRow[]][] = [
    ['Primitive', analysis.byPrimitive],
    ['DAG', analysis.byLevel],
  ];
  return (
    <section className="grid min-w-0 gap-3">
      <h3 className="text-lg font-semibold">
        {fr ? 'Origine des triangles de la capture' : 'Where capture triangles come from'}
      </h3>
      <p>
        {formatValue(analysis.total, locale)}{' '}
        {fr ? 'triangles · pages inconnues :' : 'triangles · unknown pages:'} {analysis.unknown}
      </p>
      <p className="text-sm leading-relaxed text-base-content/75">
        {fr
          ? 'Coupe de la capture stabilisée ; elle peut différer de la dernière image mesurée en mouvement.'
          : 'Settled capture cut; it may differ from the last measured moving frame.'}
      </p>
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
    </section>
  );
}
