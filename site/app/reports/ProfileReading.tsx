import { useState } from 'react';
import { useWords } from '../i18n.ts';
import type { ReactNode } from 'react';
import { Collapse } from '../ui/Collapse.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import { Alert } from '../ui/Alert.tsx';
import { formatValue, metricValue } from '../../reports/metrics.ts';
import { recordLabel } from '../../reports/presentation.ts';
import { BarChart } from '../ui/BarChart.tsx';
import { Details } from './Details.tsx';
import { Conditions } from './Conditions.tsx';
import { Diagnostics } from './Diagnostics.tsx';
import type { Report, ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';
import type { BarChartRow } from '../ui/BarChart.tsx';

interface ProfileReadingProps {
  record: ReportRecord;
  report: Report;
  locale: Locale;
  filters?: ReactNode;
}

/** One reading's CPU and GPU charts, with its exact values and conditions folded below. */
export function ProfileReading({ record: r, report, locale, filters }: ProfileReadingProps) {
  const [clock, setClock] = useState('cpu');
  const t = useWords(locale);
  const charts: { id: string; label: string; rows: BarChartRow[] }[] = [
    {
      id: 'cpu',
      label: t('profile.cpu'),
      rows: [
        {
          label: t('profile.cpuOverall'),
          value: metricValue(r, 'cpu'),
          p95: r.data.cpuFrameMs?.p95,
          tone: 'info',
        },
      ],
    },
    {
      id: 'gpu',
      label: t('profile.gpu'),
      rows: (r.data.passesGpu?.passes ?? []).map((p) => ({
        id: p.name,
        label: p.name,
        value: p.gpuMs?.p50 ?? null,
        p95: p.gpuMs?.p95,
      })),
    },
  ];
  return (
    <>
      <p>
        {r.canvas?.width} × {r.canvas?.height} · {t('profile.conditions')}
      </p>
      <Tabs
        sticky
        accessory={filters}
        label={t('profile.work')}
        value={clock}
        onChange={setClock}
        items={charts.map(({ id, label, rows }) => ({
          id,
          label,
          render: () => (
            <>
              {id === 'cpu' && <p>{t('profile.cpuNote')}</p>}
              {id === 'cpu' && r.data.imageTenue && <p>{t('profile.reused')}</p>}
              {id === 'cpu' && r.data.cheminCalcul?.clockCoarse && (
                <p>{t('profile.coarseClock')}</p>
              )}
              {id === 'gpu' && <p>{t('profile.gpuNote')}</p>}
              {rows.length ? (
                <BarChart
                  title={label}
                  format={(v) => formatValue(v, locale, 'ms')}
                  missingLabel={t('report.notMeasured')}
                  rows={rows}
                />
              ) : (
                <Alert>{t('profile.noTimings')}</Alert>
              )}
            </>
          ),
        }))}
      />
      <Collapse surface="nested" title={t('profile.exact')}>
        {() => (
          <>
            <Conditions a={r} locale={locale} />
            <Diagnostics a={r} locale={locale} />
            <Details
              record={r}
              report={report}
              locale={locale}
              label={recordLabel(report, r, locale)}
            />
          </>
        )}
      </Collapse>
    </>
  );
}
