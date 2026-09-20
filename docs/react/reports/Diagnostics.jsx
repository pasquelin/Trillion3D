import { Table } from '../components/Table.jsx';
import { readingName } from '../../js/reports/presentation.js';
import { DIAGNOSTICS, diagnosticValue } from '../../js/reports/diagnostics.js';
import { formatValue } from '../../js/reports/metrics.js';
export function Diagnostics({ a, b, locale }) {
  const language = locale === 'fr' ? 1 : 0;
  return (
    <>
      {DIAGNOSTICS.map((group) => (
        <section className="grid min-w-0 gap-3" key={group.title[0]}>
          <h3 className="text-lg font-semibold">{group.title[language]}</h3>
          <Table>
            <thead>
              <tr>
                <th scope="col">{group.title[language]}</th>
                <th scope="col">{readingName(a, locale)}</th>
                {b && <th scope="col">{readingName(b, locale)}</th>}
              </tr>
            </thead>
            <tbody>
              {group.fields.map(([path, en, fr, unit]) => (
                <tr key={path}>
                  <th scope="row">{language ? fr : en}</th>
                  {[a, b].filter(Boolean).map((record, i) => (
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
          </Table>
        </section>
      ))}
    </>
  );
}
