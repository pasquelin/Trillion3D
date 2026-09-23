import { useWords } from '../i18n.ts';
import { Table } from '../ui/Table.tsx';
import { readingName } from '../../reports/presentation.ts';
import { Cut } from './Cut.tsx';
import { formatValue } from '../../reports/metrics.ts';
import { Alert } from '../ui/Alert.tsx';
import type { Report, ReportRecord, TimingStat } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface DetailsProps {
  record?: ReportRecord | null;
  report: Report;
  locale: Locale;
  label?: string;
}

interface TimingsProps {
  title: string;
  rows?: [string, TimingStat | null][];
  locale: Locale;
}

function Timings({ title, rows, locale }: TimingsProps) {
  if (!rows?.length) return null;
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3">
      <h3 className="text-lg font-semibold">{title}</h3>
      <Table>
        <thead>
          <tr>
            <th scope="col">{title}</th>
            <th scope="col">p50</th>
            <th scope="col">p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, stat], index) => (
            <tr key={index}>
              <th scope="row">{name}</th>
              <td>{formatValue(stat?.p50, locale, 'ms')}</td>
              <td>{formatValue(stat?.p95, locale, 'ms')}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

export function Details({ record, report, locale, label }: DetailsProps) {
  const t = useWords(locale);
  if (!record) return null;
  const run = report.runs.find((item) => item.id === record.runId);
  const fields: [string, string | number | boolean | null | undefined][] = [
    [t('report.commit'), record.commit],
    [t('report.date'), run?.startedAt ? new Date(run.startedAt).toLocaleString(locale) : null],
    [t('report.browser'), record.provenance?.browser],
    [t('report.machine'), record.provenance?.machine?.cpu],
    [t('report.display'), record.provenance?.displayCapHz],
    [t('report.method'), record.gpuMethod],
    [t('report.assetKey'), record.assetKey],
    [t('report.canvas'), record.canvas ? JSON.stringify(record.canvas) : null],
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 [&_dd]:break-all">
      <h3 className="text-lg font-semibold">{readingName(record, locale)}</h3>
      {record.data.imageTenue && <Alert>{t('report.idle')}</Alert>}
      <dl>
        {fields.map(([title, value]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{value ?? t('report.unknown')}</dd>
          </div>
        ))}
      </dl>
      <Timings
        title={t('report.cpuSteps')}
        locale={locale}
        rows={record.data.profilParEtape?.stages?.map((s) => [s.stage, s.cpuMs])}
      />
      <Timings
        title={t('report.gpuPasses')}
        locale={locale}
        rows={record.data.passesGpu?.passes?.map((p) => [p.name, p.gpuMs])}
      />
      <Cut analysis={record.data.cutAnalysis} locale={locale} />
      <p>{t('report.detailsNote')}</p>
      <a className="btn btn-outline btn-sm" href={`reports/${report.id}/${run?.source}`} download>
        {t('report.source')} · {label}
      </a>
    </div>
  );
}
