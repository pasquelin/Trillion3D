import { Table } from '../ui/Table.tsx';
import { readingName } from '../../reports/presentation.ts';
import { DIAGNOSTICS, diagnosticValue } from '../../reports/diagnostics.ts';
import { formatValue } from '../../reports/metrics.ts';
import type { ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

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
        <section className="grid min-w-0 grid-cols-1 gap-3" key={group.title[0]}>
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
