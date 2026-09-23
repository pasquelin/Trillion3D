import { useWords } from '../i18n.ts';
import { Table } from '../ui/Table.tsx';
import { METRICS, METRIC_KEYS, metricValue, formatValue } from '../../reports/metrics.ts';
import { metricLabel, reportCopy } from '../../reports/copy.ts';
import { missingMetric } from '../../reports/availability.ts';
import { readingName } from '../../reports/presentation.ts';
import { comparison } from '../../reports/compare.ts';
import type { ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface ComparisonProps {
  a: ReportRecord;
  b?: ReportRecord | null;
  variable?: string;
  locale: Locale;
}

export function Comparison({ a, b, variable, locale }: ComparisonProps) {
  const c = reportCopy(locale);
  const t = useWords(locale);
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3">
      <h4 className="font-semibold">
        {readingName(a, locale)} / {readingName(b, locale)}
      </h4>
      <p className="text-sm leading-relaxed text-base-content/75">{t('report.differenceNote')}</p>
      <Table>
        <thead>
          <tr>
            <th scope="col">{c.reading}</th>
            <th scope="col">{readingName(a, locale)}</th>
            <th scope="col">{readingName(b, locale)}</th>
            <th scope="col">{t('report.difference')}</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key) => {
            const metric = METRICS[key];
            const left = metricValue(a, key),
              right = metricValue(b, key);
            const controlled = comparison(a, b, key, variable);
            const difference = left !== null && right !== null ? right - left : null;
            const hasStat = 'stat' in metric && Boolean(metric.stat);
            return (
              <tr key={key}>
                <th scope="row">
                  {metricLabel(key, locale)}
                  {hasStat && <small>p50 · {metric.unit}</small>}
                </th>
                {[a, b].map((r, i) => (
                  <td key={i}>
                    {metricValue(r, key) === null
                      ? missingMetric(r, key, locale)
                      : formatValue(metricValue(r, key), locale, metric.unit)}
                    {hasStat && metricValue(r, key, 'p95') !== null && (
                      <small>
                        p95 · {formatValue(metricValue(r, key, 'p95'), locale, metric.unit)}
                      </small>
                    )}
                  </td>
                ))}
                <td>
                  {difference === null
                    ? t('report.notCalculable')
                    : formatValue(difference, locale, metric.unit)}
                  {controlled.status === 'descriptive' && controlled.percent !== null && (
                    <small>{formatValue(controlled.percent, locale, '%')}</small>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="text-sm leading-relaxed text-base-content/75">{c.p95}</p>
    </section>
  );
}
