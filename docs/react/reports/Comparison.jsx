import { METRICS, metricValue, formatValue } from '../../js/reports/metrics.js';
import { metricLabel, reportCopy } from '../../js/reports/copy.js';
import { comparison } from '../../js/reports/compare.js';
import { Alert } from '../components/UI.jsx';
export function Comparison({ a, b, variable, locale }) {
  const c = reportCopy(locale);
  const check = comparison(a, b, 'cpu', variable);
  return (
    <>
      <Alert tone="info">
        {c[check.status]} {check.reasons?.map((key) => c[key] ?? key).join(' · ')}
      </Alert>
      <p className="report-note">{c.units}</p>
      <div className="report-table">
        <table className="table">
          <caption className="sr-only">{c.compare}</caption>
          <thead>
            <tr>
              <th scope="col">{c.reading}</th>
              <th scope="col">A</th>
              <th scope="col">B</th>
              <th scope="col">{c.change}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(METRICS).map(([key, metric]) => {
              const left = metricValue(a, key),
                right = metricValue(b, key);
              const delta = comparison(a, b, key, variable);
              const max = Math.max(left ?? 0, right ?? 0);
              return (
                <tr key={key}>
                  <th scope="row">
                    {metricLabel(key, locale)}
                    {metric.stat && <small>p50 · {metric.unit}</small>}
                  </th>
                  {[left, right].map((value, index) => (
                    <td key={index}>
                      <span title={value === null ? c.unmeasured : undefined}>
                        {formatValue(value, locale, metric.unit)}
                      </span>
                      {value !== null && max > 0 && (
                        <span
                          className={`report-bar ${index ? 'candidate' : ''}`}
                          style={{ width: `${(value / max) * 100}%` }}
                        />
                      )}
                      {metric.stat && (
                        <small>
                          p95{' '}
                          {formatValue(metricValue(index ? b : a, key, 'p95'), locale, metric.unit)}
                        </small>
                      )}
                    </td>
                  ))}
                  <td>
                    {formatValue(delta.delta, locale, metric.unit)}
                    {delta.percent !== null && (
                      <small>{formatValue(delta.percent, locale, '%')}</small>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="report-note">{c.p95}</p>
    </>
  );
}
