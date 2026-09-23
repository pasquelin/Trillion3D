import type { TFunction } from 'i18next';
import { useWords } from '../i18n.ts';
import { readingGroups } from '../../reports/sources.ts';
import { Section } from '../ui/Text.tsx';
import { Table } from '../ui/Table.tsx';
import { flattenFields } from '../../reports/availability.ts';
import { recordLabel, sceneName } from '../../reports/presentation.ts';
import { viewName } from '../../reports/names.ts';
import { Collapse } from '../ui/Collapse.tsx';
import type { Report, ReportSource } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface AllReadingsProps {
  report: Report;
  sources: ReportSource[];
  locale: Locale;
}

function cell(value: unknown, locale: Locale, t: TFunction): string {
  if (value === null || value === undefined) return t('report.notRecorded');
  if (typeof value === 'number')
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value);
  if (typeof value === 'boolean') return t(value ? 'report.yes' : 'report.no');
  return String(value);
}

export function AllReadings({ report, sources, locale }: AllReadingsProps) {
  const t = useWords(locale);
  const groups = readingGroups(sources);
  return (
    <Section id="report-all-values" title={t('report.allValues')}>
      <p>{t('report.allValuesLead')}</p>
      {[...groups].map(([key, records]) => {
        const maps: Map<string, unknown>[] = records.map((r) => flattenFields(r.complete));
        const fields = [...new Set(maps.flatMap((m) => [...m.keys()]))];
        return (
          <Collapse
            key={key}
            title={`${sceneName(records[0].scene)} · ${viewName(records[0].view ?? '—', locale)} · ${records[0].quality ?? '—'} px · ${report.runs.find((run) => run.id === records[0].runId)?.name}`}
          >
            {() => (
              <Table label={key} wide>
                <thead>
                  <tr>
                    <th scope="col">{t('report.sourceField')}</th>
                    {records.map((r) => (
                      <th scope="col" key={r.id}>
                        {recordLabel(report, r, locale)} ·{' '}
                        {t(
                          r.side.endsWith('-aa') ? 'report.repeatCapture' : 'report.primaryReading',
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field}>
                      <th scope="row">{field}</th>
                      {maps.map((m, i) => (
                        <td key={i}>{cell(m.get(field), locale, t)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Collapse>
        );
      })}
    </Section>
  );
}
