import { useWords } from '../i18n.ts';
import { Table } from '../ui/Table.tsx';
import { runName } from '../../reports/names.ts';
import type { Report } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface CampaignRunsProps {
  report: Report;
  locale: Locale;
}

export function CampaignRuns({ report, locale }: CampaignRunsProps) {
  const t = useWords(locale);
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3">
      <h3 className="text-lg font-semibold">
        {t('report.runs')} · {report.runs.length}
      </h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{t('report.reading')}</th>
            <th scope="col">{t('report.scene')}</th>
            <th scope="col">{t('report.source')}</th>
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
                    {t(`report.status.${run.status}`)}
                  </a>
                ) : (
                  t('report.status.missing')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}
