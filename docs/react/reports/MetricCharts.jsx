import { assessment, ASSESSMENT_LABELS, engineTone } from '../../js/reports/assessment.js';
import { engineName } from '../../js/reports/names.js';
import { missingMetric } from '../../js/reports/availability.js';
import { METRICS, metricValue, formatValue } from '../../js/reports/metrics.js';
import { metricLabel } from '../../js/reports/copy.js';
import { recordLabel } from '../../js/reports/presentation.js';
import { ChartGrid } from '../components/ChartGrid.jsx';
import { BarChart } from '../components/BarChart.jsx';
import { Collapse } from '../components/Collapse.jsx';
import { Table } from '../components/Table.jsx';
export function MetricCharts({
  records,
  report,
  locale,
  metrics,
  compact = false,
  labelRecord,
  colorByEngine = false,
  columns = 2,
}) {
  const label = (r) =>
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
              unit={METRICS[key].unit}
              format={(v) => formatValue(v, locale, METRICS[key].unit)}
              missingLabel={locale === 'fr' ? 'Non mesuré' : 'Not measured'}
              rows={records.map((r) => ({
                id: r.id,
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
