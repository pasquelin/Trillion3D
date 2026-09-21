import { Table } from '../components/Table.tsx';
import { readingName } from '../../reports/presentation.ts';
import { Cut } from './Cut.tsx';
import { reportCopy } from '../../reports/copy.ts';
import { formatValue } from '../../reports/metrics.ts';
import { Alert } from '../components/UI.tsx';
import type { Report, ReportRecord, TimingStat } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

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
    <section className="grid min-w-0 gap-3">
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
  const c = reportCopy(locale);
  if (!record) return null;
  const run = report.runs.find((item) => item.id === record.runId);
  const fields: [string, string | number | boolean | null | undefined][] = [
    [c.commit, record.commit],
    [c.date, run?.startedAt ? new Date(run.startedAt).toLocaleString(locale) : null],
    [c.browser, record.provenance?.browser],
    [c.machine, record.provenance?.machine?.cpu],
    [c.display, record.provenance?.displayCapHz],
    [c.method, record.gpuMethod],
    [c.assetKey, record.assetKey],
    [c.canvas, record.canvas ? JSON.stringify(record.canvas) : null],
  ];
  return (
    <div className="grid min-w-0 gap-4 [&_dd]:break-all">
      <h3 className="text-lg font-semibold">{readingName(record, locale)}</h3>
      {record.data.imageTenue && <Alert>{c.idle}</Alert>}
      <dl>
        {fields.map(([title, value]) => (
          <div key={title}>
            <dt>{title}</dt>
            <dd>{value ?? c.unknown}</dd>
          </div>
        ))}
      </dl>
      <Timings
        title={c.cpuSteps}
        locale={locale}
        rows={record.data.profilParEtape?.stages?.map((s) => [s.stage, s.cpuMs])}
      />
      <Timings
        title={c.gpuPasses}
        locale={locale}
        rows={record.data.passesGpu?.passes?.map((p) => [p.name, p.gpuMs])}
      />
      <Cut analysis={record.data.cutAnalysis} locale={locale} />
      <p>{c.detailsNote}</p>
      <a className="btn btn-outline btn-sm" href={`reports/${report.id}/${run?.source}`} download>
        {c.source} · {label}
      </a>
    </div>
  );
}
