import { assessment, ASSESSMENT_LABELS, engineTone } from '../../reports/assessment.ts';
import { engineName } from '../../reports/names.ts';
import { missingMetric } from '../../reports/availability.ts';
import { METRICS, metricValue, formatValue } from '../../reports/metrics.ts';
import { metricLabel } from '../../reports/copy.ts';
import { recordLabel, runOf } from '../../reports/presentation.ts';
import { ChartGrid } from '../components/ChartGrid.tsx';
import { BarChart } from '../components/BarChart.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { Table } from '../components/Table.tsx';
import type { MetricKey, Report, ReportRecord } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface MetricChartsProps {
  records: ReportRecord[];
  report: Report;
  locale: Locale;
  metrics: MetricKey[];
  compact?: boolean;
  labelRecord?: (record: ReportRecord) => string;
  colorByEngine?: boolean;
  columns?: number;
}

export function MetricCharts({
  records,
  report,
  locale,
  metrics,
  compact = false,
  labelRecord,
  colorByEngine = false,
  columns = 2,
}: MetricChartsProps) {
  const label = (r: ReportRecord) =>
    labelRecord
      ? labelRecord(r)
      : compact
        ? engineName(r.engine).replace(' · WebGPU', '')
        : recordLabel(report, r, locale);
  const missing = metrics.flatMap((key) =>
    records.filter((r) => metricValue(r, key) === null).map((r) => ({ key, record: r })),
  );
  return (
    <div className="grid min-w-0 gap-4">
      <ChartGrid columns={columns}>
        {metrics.map((key) => {
          return (
            <BarChart
              key={key}
              title={metricLabel(key, locale)}
              format={(v) => formatValue(v, locale, METRICS[key].unit)}
              missingLabel={locale === 'fr' ? 'Non mesuré' : 'Not measured'}
              rows={records.map((r) => ({
                id: colorByEngine
                  ? r.engine
                  : `${runOf(report, r)}:${r.engine}:${r.variant ?? ''}:${r.canvas?.width}:${r.canvas?.height}`,
                label: label(r),
                value: metricValue(r, key),
                tone: colorByEngine ? engineTone(r.engine) : assessment(r, key).tone,
                status:
                  colorByEngine || assessment(r, key).code === 'noTarget'
                    ? null
                    : ASSESSMENT_LABELS[assessment(r, key).code][locale === 'fr' ? 1 : 0],
              }))}
            />
          );
        })}
      </ChartGrid>
      {missing.length > 0 && (
        <Collapse
          surface="nested"
          title={`${locale === 'fr' ? 'Mesures manquantes' : 'Missing measurements'} · ${missing.length}`}
        >
          <Table>
            <thead>
              <tr>
                <th scope="col">{locale === 'fr' ? 'Mesure' : 'Measurement'}</th>
                <th scope="col">{locale === 'fr' ? 'Cas' : 'Case'}</th>
                <th scope="col">{locale === 'fr' ? 'Explication' : 'Explanation'}</th>
              </tr>
            </thead>
            <tbody>
              {missing.map(({ key, record }) => (
                <tr key={`${key}-${record.id}`}>
                  <th scope="row">{metricLabel(key, locale)}</th>
                  <td>{label(record)}</td>
                  <td>{missingMetric(record, key, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Collapse>
      )}
    </div>
  );
}
