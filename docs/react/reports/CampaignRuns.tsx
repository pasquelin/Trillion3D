import type { ReactElement } from 'react';
import { Table } from '../components/Table.tsx';
import { reportCopy } from '../../js/reports/copy.js';
import { runName } from '../../js/reports/names.js';
import type { Report, RunStatus } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

export interface CampaignRunsProps {
  report: Report;
  locale: Locale;
}

const STATUS: Record<RunStatus, [string, string]> = {
  complete: ['Complete', 'Terminée'],
  failed: ['Failed or incomplete', 'Échec ou incomplète'],
  missing: ['No measurement file', 'Aucun fichier de mesure'],
};

export function CampaignRuns({ report, locale }: CampaignRunsProps): ReactElement {
  const c = reportCopy(locale);
  return (
    <section className="grid min-w-0 gap-3">
      <h3 className="text-lg font-semibold">
        {c.runs} · {report.runs.length}
      </h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{c.reading}</th>
            <th scope="col">{c.scene}</th>
            <th scope="col">{c.source}</th>
          </tr>
        </thead>
        <tbody>
          {report.runs.map((run) => (
            <tr key={run.id}>
              <th scope="row">{runName(run.name, locale)}</th>
              <td>{run.scene ?? '—'}</td>
              <td>
                {run.source ? (
                  <a className="link" href={`reports/${report.id}/${run.source}`} download>
                    {STATUS[run.status][locale === 'fr' ? 1 : 0]}
                  </a>
                ) : (
                  STATUS.missing[locale === 'fr' ? 1 : 0]
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
