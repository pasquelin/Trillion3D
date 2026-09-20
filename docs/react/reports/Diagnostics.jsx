import { DIAGNOSTICS, diagnosticValue } from '../../js/reports/diagnostics.js';
import { formatValue } from '../../js/reports/metrics.js';
export function Diagnostics({ a, b, locale }) {
  const language = locale === 'fr' ? 1 : 0;
  return (
    <>
      {DIAGNOSTICS.map((group) => (
        <details key={group.title[0]}>
          <summary>{group.title[language]}</summary>
          <div className="report-table">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{group.title[language]}</th>
                  <th scope="col">A</th>
                  <th scope="col">B</th>
                </tr>
              </thead>
              <tbody>
                {group.fields.map(([path, en, fr, unit]) => (
                  <tr key={path}>
                    <th scope="row">{language ? fr : en}</th>
                    {[a, b].map((record, i) => (
                      <td key={i}>
                        {formatValue(
                          diagnosticValue(record, path),
                          locale,
                          unit === 'bytes' ? 'B' : unit,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </>
  );
}
