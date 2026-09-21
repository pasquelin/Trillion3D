import { Table } from '../components/Table.tsx';
import { readingName } from '../../js/reports/presentation.js';
import { DIAGNOSTICS, diagnosticValue } from '../../js/reports/diagnostics.js';
import { formatValue } from '../../js/reports/metrics.js';
import type { ReportRecord } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface DiagnosticsProps {
  a: ReportRecord;
  b?: ReportRecord | null;
  locale: Locale;
}

export function Diagnostics({ a, b, locale }: DiagnosticsProps) {
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
                  {[a, b]
                    .filter((r): r is ReportRecord => Boolean(r))
                    .map((record, i) => (
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
