import type { ReactElement } from 'react';
import { Table } from '../components/Table.tsx';
import { METRICS, metricValue, formatValue } from '../../js/reports/metrics.js';
import { metricLabel, reportCopy } from '../../js/reports/copy.js';
import { missingMetric } from '../../js/reports/availability.js';
import { readingName } from '../../js/reports/presentation.js';
import { comparison } from '../../js/reports/compare.js';
import type { ReportRecord } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

export interface ComparisonProps {
  a: ReportRecord;
  b?: ReportRecord | null;
  variable?: string;
  locale: Locale;
}

export function Comparison({ a, b, variable, locale }: ComparisonProps): ReactElement {
  const c = reportCopy(locale),
    fr = locale === 'fr';
  return (
    <section className="grid min-w-0 gap-3">
      <h4 className="font-semibold">
        {readingName(a, locale)} / {readingName(b, locale)}
      </h4>
      <p className="text-sm leading-relaxed text-base-content/75">
        {fr
          ? 'Écart observé = deuxième valeur moins première valeur. Il décrit ces mesures ; sans protocole complet et répétitions, il ne prouve pas un gain reproductible.'
          : 'Observed difference = second value minus first value. It describes these readings; without a complete protocol and repeated runs, it does not prove a reproducible gain.'}
      </p>
      <Table>
        <thead>
          <tr>
            <th scope="col">{c.reading}</th>
            <th scope="col">{readingName(a, locale)}</th>
            <th scope="col">{readingName(b, locale)}</th>
            <th scope="col">{fr ? 'Écart observé' : 'Observed difference'}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(METRICS).map(([key, metric]) => {
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
                    ? fr
                      ? 'Non calculable'
                      : 'Not calculable'
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
