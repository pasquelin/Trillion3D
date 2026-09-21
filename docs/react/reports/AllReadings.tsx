import type { ReactElement } from 'react';
import { readingGroups } from '../../js/reports/sources.js';
import { Table } from '../components/Table.tsx';
import { flattenFields } from '../../js/reports/availability.js';
import { recordLabel, sceneName } from '../../js/reports/presentation.js';
import { viewName } from '../../js/reports/names.js';
import { Collapse } from '../components/Collapse.tsx';
import type { Report, ReportRecord, ReportSource, SourceReadingRecord } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

export interface AllReadingsProps {
  report: Report;
  sources?: ReportSource[];
  locale: Locale;
}

function cell(value: unknown, locale: Locale): string {
  if (value === null || value === undefined)
    return locale === 'fr' ? 'Non enregistré' : 'Not recorded';
  if (typeof value === 'number')
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(value);
  if (typeof value === 'boolean')
    return value ? (locale === 'fr' ? 'Oui' : 'Yes') : locale === 'fr' ? 'Non' : 'No';
  return String(value);
}

export function AllReadings({ report, sources = [], locale }: AllReadingsProps): ReactElement {
  const groups = readingGroups(sources) as Map<string, SourceReadingRecord[]>;
  return (
    <section className="grid min-w-0 gap-4" id="report-all-values">
      <h2>
        {locale === 'fr' ? 'Tous les chiffres, sans filtre' : 'Every recorded value, unfiltered'}
      </h2>
      <p>
        {locale === 'fr'
          ? 'Une colonne par mesure, une ligne par champ source. Les réglages, la provenance, les distributions complètes et chaque compteur sont disponibles dans les détails. Faites défiler horizontalement pour comparer les exécutions. Les noms techniques correspondent exactement aux fichiers sources ; les octets restent en octets.'
          : 'One column per reading, one row per source field. Settings, provenance, full distributions and every counter are available in the details. Scroll horizontally to compare runs. Technical names match the source files exactly; bytes remain bytes.'}
      </p>
      {[...groups].map(([key, records]) => {
        const maps = records.map((r) => flattenFields(r.complete) as Map<string, unknown>);
        const fields = [...new Set(maps.flatMap((m) => [...m.keys()]))];
        const first = records[0];
        const runNameValue = report.runs.find((run) => run.id === first?.runId)?.name ?? '';
        return (
          <Collapse
            key={key}
            title={`${sceneName(first?.scene)} · ${viewName(first?.view ?? '—', locale)} · ${first?.quality ?? '—'} px · ${runNameValue}`}
          >
            {() => (
              <Table label={key} wide>
                <thead>
                  <tr>
                    <th scope="col">{locale === 'fr' ? 'Champ source' : 'Source field'}</th>
                    {records.map((r) => (
                      <th scope="col" key={r.id}>
                        {recordLabel(report, r as unknown as ReportRecord, locale)} ·{' '}
                        {r.side.endsWith('-aa')
                          ? locale === 'fr'
                            ? 'capture répétée'
                            : 'repeat capture'
                          : locale === 'fr'
                            ? 'mesure principale'
                            : 'primary reading'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field}>
                      <th scope="row">{field}</th>
                      {maps.map((m, i) => (
                        <td key={i}>{cell(m.get(field), locale)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Collapse>
        );
      })}
    </section>
  );
}
