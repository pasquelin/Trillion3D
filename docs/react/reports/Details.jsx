import { Cut } from './Cut.jsx';
import { reportCopy } from '../../js/reports/copy.js';
import { formatValue } from '../../js/reports/metrics.js';
import { Alert } from '../components/UI.jsx';
function Timings({ title, rows, locale }) {
  if (!rows?.length) return null;
  return (
    <details>
      <summary>{title}</summary>
      <div className="report-table">
        <table className="table">
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
        </table>
      </div>
    </details>
  );
}
export function Details({ record, report, locale, label }) {
  const c = reportCopy(locale);
  if (!record) return null;
  const run = report.runs.find((item) => item.id === record.runId);
  const fields = [
    [c.commit, record.commit],
    [c.date, run.startedAt && new Date(run.startedAt).toLocaleString(locale)],
    [c.browser, record.provenance?.browser],
    [c.machine, record.provenance?.machine?.cpu],
    [c.display, record.provenance?.displayCapHz],
    [c.method, record.gpuMethod],
    [c.assetKey, record.assetKey],
    [c.canvas, record.canvas && JSON.stringify(record.canvas)],
  ];
  return (
    <div className="report-details">
      <h3>
        {label} · {record.engine}
      </h3>
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
      <a className="btn btn-outline btn-sm" href={`reports/${report.id}/${run.source}`} download>
        {c.source} · {label}
      </a>
    </div>
  );
}
