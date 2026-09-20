import { engineName } from '../../js/reports/names.js';
import { Stat, StatGroup } from '../components/Stats.jsx';
import { metricLabel, reportCopy } from '../../js/reports/copy.js';
import { metricValue, formatValue, METRICS } from '../../js/reports/metrics.js';
export function Overview({ a, b, report, locale }) {
  const c = reportCopy(locale);
  return (
    <>
      <p className="report-note">
        {report.id} · {report.runs.length} {c.runs.toLocaleLowerCase(locale)} ·{' '}
        {report.records.length} {c.readings.toLocaleLowerCase(locale)} ·{' '}
        {report.runs.filter((r) => r.status !== 'complete').length}{' '}
        {c.incomplete.toLocaleLowerCase(locale)}
      </p>
      <p className="report-note">
        A · {engineName(a?.engine) ?? '—'} / B · {engineName(b?.engine) ?? '—'}
      </p>
      <StatGroup>
        {['gpu', 'cpu', 'geometry'].map((key) => (
          <Stat
            key={key}
            title={metricLabel(key, locale)}
            description={`A ${formatValue(metricValue(a, key), locale, METRICS[key].unit)} · B ${formatValue(metricValue(b, key), locale, METRICS[key].unit)}`}
          >
            {formatValue(metricValue(b, key), locale, METRICS[key].unit)}
          </Stat>
        ))}
      </StatGroup>
    </>
  );
}
