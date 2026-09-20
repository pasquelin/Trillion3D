import { SceneNotice } from './SceneNotice.jsx';
import { useState } from 'react';
import { Section } from '../components/Section.jsx';
import { Collapse } from '../components/Collapse.jsx';
import { Tabs } from '../components/Tabs.jsx';
import { sceneName, runOf } from '../../js/reports/presentation.js';
import { viewName } from '../../js/reports/names.js';
import { MetricCharts } from './MetricCharts.jsx';
import { Comparison } from './Comparison.jsx';
export function SceneReport({ scene, report, locale }) {
  const [selected, setSelected] = useState('sol');
  const fr = locale === 'fr';
  const records = report.records.filter(
    (r) =>
      r.scene === scene && ['three-nu', 'three-lod'].includes(runOf(report, r)) && r.quality === 1,
  );
  const fallback = report.records.filter(
    (r) => r.scene === scene && runOf(report, r) === 'mobile' && r.quality === 1,
  );
  const views = [...new Set((records.length ? records : fallback).map((r) => r.view))];
  return (
    <Section title={sceneName(scene)}>
      <SceneNotice
        note={report.records.find((r) => r.scene === scene && r.sceneNote)?.sceneNote}
        locale={locale}
      />
      <Tabs
        sticky
        label={fr ? 'Point de vue' : 'Viewpoint'}
        value={selected}
        onChange={setSelected}
        items={views.map((view) => ({
          id: view,
          label: viewName(view, locale),
          render: () => {
            const all = records.filter((r) => r.view === view);
            const web =
              all.find(
                (r) => r.engine === 'webgpu-page-raster' && runOf(report, r) === 'three-nu',
              ) ??
              all.find((r) => r.engine === 'webgpu-page-raster') ??
              fallback.find((r) => r.view === view);
            const rows = [...all.filter((r) => r.engine !== 'webgpu-page-raster'), web].filter(
              Boolean,
            );
            return (
              <div className="grid min-w-0 gap-4">
                <p>
                  {web?.canvas?.width} × {web?.canvas?.height} ·{' '}
                  {fr
                    ? 'seuil : 1 px · valeurs médianes · temps plus court = mieux'
                    : 'threshold: 1 px · median values · shorter duration = better'}
                </p>
                <MetricCharts
                  {...{ report, locale }}
                  records={rows}
                  colorByEngine
                  compact
                  metrics={['cpu', 'triangles', 'calls', 'geometry', 'textures', 'textureBudget']}
                />
                <MetricCharts
                  {...{ report, locale }}
                  records={rows}
                  colorByEngine
                  compact
                  metrics={['gpu', 'sync']}
                />
                <Collapse
                  surface="nested"
                  title={
                    fr
                      ? 'Chiffres exacts, p95 et limites de comparaison'
                      : 'Exact figures, p95 and comparison limits'
                  }
                >
                  {all
                    .filter((r) => r.engine !== 'webgpu-page-raster')
                    .map((r) => (
                      <Comparison
                        key={r.id}
                        a={r}
                        b={all.find(
                          (other) => other.id !== r.id && other.differencePair === r.differencePair,
                        )}
                        locale={locale}
                        variable="engine"
                      />
                    ))}
                </Collapse>
              </div>
            );
          },
        }))}
      />
    </Section>
  );
}
