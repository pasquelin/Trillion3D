import { useState } from 'react';
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
  const fr = locale === 'fr';
  const charts: { id: string; label: string; rows: BarChartRow[] }[] = [
    {
      id: 'cpu',
      label: fr ? 'CPU · préparer l’image' : 'CPU · prepare the image',
      rows: [
        {
          label: fr ? 'Temps CPU global' : 'Overall CPU time',
          value: metricValue(r, 'cpu'),
          p95: r.data.cpuFrameMs?.p95,
          tone: 'info',
        },
      ],
    },
    {
      id: 'gpu',
      label: fr ? 'GPU · dessiner l’image' : 'GPU · draw the image',
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
        {r.canvas?.width} × {r.canvas?.height} ·{' '}
        {fr ? 'Caméra mobile, soleil et ombres.' : 'Moving camera, sun and shadows.'}
      </p>
      <Tabs
        sticky
        accessory={filters}
        label={fr ? 'Travail mesuré' : 'Measured work'}
        value={clock}
        onChange={setClock}
        items={charts.map(({ id, label, rows }) => ({
          id,
          label,
          render: () => (
            <>
              {id === 'cpu' && (
                <p>
                  {fr
                    ? 'La barre montre la durée globale mesurée. Les médianes des étapes ne s’additionnent pas pour retrouver ce total.'
                    : 'The bar shows the measured overall duration. Stage medians do not add up to this total.'}
                </p>
              )}
              {id === 'cpu' && r.data.imageTenue && (
                <p>
                  {fr
                    ? 'Cette image a été réutilisée : une partie du travail de rendu a été évitée.'
                    : 'This image was reused, avoiding part of the rendering work.'}
                </p>
              )}
              {id === 'cpu' && r.data.cheminCalcul?.clockCoarse && (
                <p>
                  {fr
                    ? 'Horloge peu précise : 0 ms ne prouve pas qu’une étape ne coûte rien. Les valeurs exactes sont dans les détails.'
                    : 'Coarse clock: 0 ms does not prove a stage is free. Exact readings are in the details.'}
                </p>
              )}
              {id === 'gpu' && (
                <p>
                  {fr
                    ? 'Ces étapes montrent où travaille la carte graphique. Leurs durées se chevauchent : ne les additionnez pas.'
                    : 'These stages show where the GPU works. Their timings overlap: do not add them.'}
                </p>
              )}
              {rows.length ? (
                <BarChart
                  title={label}
                  format={(v) => formatValue(v, locale, 'ms')}
                  missingLabel={fr ? 'Non mesuré' : 'Not measured'}
                  rows={rows}
                />
              ) : (
                <Alert>
                  {fr
                    ? 'Aucune durée enregistrée pour ces étapes.'
                    : 'No timings recorded for these stages.'}
                </Alert>
              )}
            </>
          ),
        }))}
      />
      <Collapse
        surface="nested"
        title={
          fr ? 'Valeurs exactes et conditions de mesure' : 'Exact values and measurement conditions'
        }
      >
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
