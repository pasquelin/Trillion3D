import { formatValue } from '../../js/reports/metrics.js';
export function Cut({ analysis, locale }) {
  if (!analysis) return null;
  const fr = locale === 'fr';
  return (
    <details>
      <summary>
        {fr ? 'Origine des triangles de la capture' : 'Where capture triangles come from'}
      </summary>
      <p>
        {formatValue(analysis.total, locale)}{' '}
        {fr ? 'triangles · pages inconnues :' : 'triangles · unknown pages:'} {analysis.unknown}
      </p>
      <p className="report-note">
        {fr
          ? 'Coupe de la capture stabilisée ; elle peut différer de la dernière image mesurée en mouvement.'
          : 'Settled capture cut; it may differ from the last measured moving frame.'}
      </p>
      {[
        ['Primitive', analysis.byPrimitive],
        ['DAG', analysis.byLevel],
      ].map(([label, rows]) => (
        <div className="report-table" key={label}>
          <table className="table">
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
          </table>
        </div>
      ))}
    </details>
  );
}
