import { useState } from 'react';
import { Collapse } from '../components/Collapse.jsx';
import { Tabs } from '../components/Tabs.jsx';
import { Alert } from '../components/UI.jsx';
import { formatValue, metricValue } from '../../js/reports/metrics.js';
import { viewName } from '../../js/reports/names.js';
import { Section } from '../components/Section.jsx';
import { recordLabel, runOf, sceneName } from '../../js/reports/presentation.js';
import { BarChart } from '../components/BarChart.jsx';
import { Details } from './Details.jsx';
import { Conditions } from './Conditions.jsx';
import { Diagnostics } from './Diagnostics.jsx';
function ProfileReading({ record: r, report, locale }) {
  const [clock, setClock] = useState('cpu');
  const fr = locale === 'fr';
  const charts = [
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
                  unit="ms"
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
function SceneProfiles({ records, report, locale }) {
  const [view, setView] = useState('sol'),
    [quality, setQuality] = useState('1');
  return (
    <Tabs
      label={locale === 'fr' ? 'Point de vue' : 'Viewpoint'}
      value={view}
      onChange={setView}
      items={[...new Set(records.map((r) => r.view))].map((id) => ({
        id,
        label: viewName(id, locale),
        render: () => (
          <Tabs
            label={locale === 'fr' ? 'Niveau de détail' : 'Detail level'}
            value={quality}
            onChange={setQuality}
            items={records
              .filter((r) => r.view === id)
              .map((r) => ({
                id: String(r.quality),
                label: `${r.quality} px`,
                render: () => <ProfileReading key={r.id} record={r} {...{ report, locale }} />,
              }))}
          />
        ),
      }))}
    />
  );
}
export function Profiles({ report, locale }) {
  const records = report.records.filter((r) => runOf(report, r) === 'mobile');
  return (
    <>
      {[...new Set(records.map((r) => r.scene))].map((scene) => (
        <Section key={scene} title={sceneName(scene)}>
          <SceneProfiles
            records={records.filter((r) => r.scene === scene)}
            {...{ report, locale }}
          />
        </Section>
      ))}
    </>
  );
}
