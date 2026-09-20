import { Table } from '../components/Table.jsx';
import { formatValue } from '../../js/reports/metrics.js';
export function Cut({ analysis, locale }) {
  if (!analysis) return null;
  const fr = locale === 'fr';
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
      {[
        ['Primitive', analysis.byPrimitive],
        ['DAG', analysis.byLevel],
      ].map(([label, rows]) => (
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
