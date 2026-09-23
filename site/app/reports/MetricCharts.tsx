import { useWords } from '../i18n.ts';
import { assessment, ASSESSMENT_LABELS, engineTone } from '../../reports/assessment.ts';
import { engineName } from '../../reports/names.ts';
import { missingMetric } from '../../reports/availability.ts';
import { METRICS, metricValue, formatValue } from '../../reports/metrics.ts';
import { metricLabel } from '../../reports/copy.ts';
import { recordLabel, runOf } from '../../reports/presentation.ts';
import { ChartGrid } from '../ui/ChartGrid.tsx';
import { BarChart } from '../ui/BarChart.tsx';
import { Collapse } from '../ui/Collapse.tsx';
import { Table } from '../ui/Table.tsx';
import { fromPair } from './fromPair.ts';
import type { Report, ReportRecord } from '../../reports/types.ts';
import type { MetricKey } from '../../reports/metrics.ts';
import type { Locale } from '../../content/locale.ts';

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
  const t = useWords(locale);
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
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <ChartGrid columns={columns}>
        {metrics.map((key) => {
          return (
            <BarChart
              key={key}
              title={metricLabel(key, locale)}
              format={(v) => formatValue(v, locale, METRICS[key].unit)}
              missingLabel={t('report.notMeasured')}
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
                    : fromPair(ASSESSMENT_LABELS[assessment(r, key).code], locale),
              }))}
            />
          );
        })}
      </ChartGrid>
      {missing.length > 0 && (
        <Collapse surface="nested" title={`${t('report.missing')} · ${missing.length}`}>
          <Table>
            <thead>
              <tr>
                <th scope="col">{t('report.measurement')}</th>
                <th scope="col">{t('report.case')}</th>
                <th scope="col">{t('report.explanation')}</th>
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
