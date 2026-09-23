import { useWords } from '../i18n.ts';
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
  const t = useWords(locale);
  return (
    <>
      {DIAGNOSTICS.map((group) => (
        <section className="grid min-w-0 grid-cols-1 gap-3" key={group.id}>
          <h3 className="text-lg font-semibold">{t(`report.diagnostics.${group.id}`)}</h3>
          <Table>
            <thead>
              <tr>
                <th scope="col">{t(`report.diagnostics.${group.id}`)}</th>
                <th scope="col">{readingName(a, locale)}</th>
                {b && <th scope="col">{readingName(b, locale)}</th>}
              </tr>
            </thead>
            <tbody>
              {group.fields.map(([id, path, unit]) => (
                <tr key={path}>
                  <th scope="row">{t(`report.diagnostics.${id}`)}</th>
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
