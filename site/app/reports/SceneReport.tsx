import { useState } from 'react';
import { SceneNotice } from './SceneNotice.tsx';
import { Section } from '../components/Section.tsx';
import { Collapse } from '../components/Collapse.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { sceneName, runOf } from '../../reports/presentation.ts';
import { viewName } from '../../reports/names.ts';
import { MetricCharts } from './MetricCharts.tsx';
import { Comparison } from './Comparison.tsx';
import type { Report, ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface SceneReportProps {
  scene: string;
  report: Report;
  locale: Locale;
}

export function SceneReport({ scene, report, locale }: SceneReportProps) {
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
              (r): r is ReportRecord => Boolean(r),
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
