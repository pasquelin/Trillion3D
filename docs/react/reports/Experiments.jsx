import { useState } from 'react';
import { Tabs } from '../components/Tabs.jsx';
import { viewName, runName, engineName } from '../../js/reports/names.js';
import { Section } from '../components/Section.jsx';
import { sceneName, runOf } from '../../js/reports/presentation.js';
import { MetricCharts } from './MetricCharts.jsx';
const GROUPS = [
  [
    'Resolution and error threshold',
    'Résolution et seuil d’erreur',
    /^(res-|raster-|three-(nu|lod)-1248)/,
    ['gpu', 'sync', 'cpu', 'triangles'],
  ],
  [
    'Lights, shadows and bounce',
    'Lumières, ombres et rebond',
    /lamp|ombre|rebond|sans-lumiere/,
    ['gpu', 'sync', 'cpu', 'calls'],
  ],
  [
    'Still frame, antialiasing and execution options',
    'Image fixe, anticrénelage et options d’exécution',
    /^(fixe|aa-off|profil-off|isolation|visible|math-)/,
    ['gpu', 'cpu', 'cadence'],
  ],
  [
    'Memory, instances and other renderers',
    'Mémoire, instances et autres moteurs',
    /./,
    ['gpu', 'cpu', 'geometry', 'textures', 'textureBudget', 'triangles'],
  ],
];
export function Experiments({ report, scene, locale }) {
  const [selected, setSelected] = useState('sol/1');
  const records = report.records.filter(
    (r) => r.scene === scene && !['three-nu', 'three-lod'].includes(runOf(report, r)),
  );
  return (
    <Section title={sceneName(scene)}>
      <Tabs
        label={locale === 'fr' ? 'Vue et qualité' : 'View and quality'}
        value={selected}
        onChange={setSelected}
        items={[...new Set(records.map((r) => `${r.view}/${r.quality}`))].map((key) => ({
          id: key,
          label: `${viewName(key.split('/')[0], locale)} · ${key.split('/')[1]} px`,
          render: () => (
            <>
              {GROUPS.map(([en, fr, , metrics], groupIndex) => {
                const rows = records.filter(
                  (r) =>
                    `${r.view}/${r.quality}` === key &&
                    GROUPS.findIndex(([, , pattern]) => pattern.test(runOf(report, r))) ===
                      groupIndex,
                );
                if (!rows.length) return null;
                return (
                  <section className="grid min-w-0 gap-4" key={en}>
                    <h3 className="text-lg font-semibold">{locale === 'fr' ? fr : en}</h3>
                    <MetricCharts
                      columns={1}
                      {...{ report, locale, metrics }}
                      records={rows}
                      labelRecord={(r) =>
                        `${runName(runOf(report, r), locale)} · ${r.variant === 'raster-calcul' ? (locale === 'fr' ? 'dessin par calcul' : 'compute drawing') : engineName(r.engine)}`
                      }
                    />
                  </section>
                );
              })}
            </>
          ),
        }))}
      />
    </Section>
  );
}
