import { useState } from 'react';
import { Select } from '../components/UI.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { viewName, runName, engineName } from '../../js/reports/names.js';
import { Section } from '../components/Section.tsx';
import { sceneName, runOf } from '../../js/reports/presentation.js';
import { MetricCharts } from './MetricCharts.tsx';
import type { MetricKey, Report } from '../types/reports.ts';
import type { Locale } from '../types/portal.ts';

interface ExperimentsProps {
  report: Report;
  scene: string;
  locale: Locale;
}

const GROUPS: [string, string, RegExp, MetricKey[]][] = [
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

export function Experiments({ report, scene, locale }: ExperimentsProps) {
  const [selected, setSelected] = useState('sol');
  const [quality, setQuality] = useState('1');
  const records = report.records.filter(
    (r) => r.scene === scene && !['three-nu', 'three-lod'].includes(runOf(report, r)),
  );
  const views = [...new Set(records.map((r) => r.view))];
  const view = views.includes(selected) ? selected : views[0];
  const qualities = [
    ...new Set(records.filter((r) => r.view === view).map((r) => String(r.quality))),
  ];
  const activeQuality = qualities.includes(quality) ? quality : qualities[0];
  return (
    <Section title={sceneName(scene)}>
      <Tabs
        sticky
        label={locale === 'fr' ? 'Position' : 'View'}
        value={selected}
        onChange={setSelected}
        accessory={
          <div className="w-24">
            <Select
              size="sm"
              aria-label={locale === 'fr' ? 'Seuil de détail' : 'Detail threshold'}
              value={activeQuality}
              onChange={(event) => setQuality(event.target.value)}
            >
              {qualities.map((value) => (
                <option key={value} value={value}>
                  {value} px
                </option>
              ))}
            </Select>
          </div>
        }
        items={views.map((key) => ({
          id: key,
          label: viewName(key, locale),
          render: () => (
            <>
              {GROUPS.map(([en, fr, , metrics], groupIndex) => {
                const rows = records.filter(
                  (r) =>
                    r.view === key &&
                    String(r.quality) === activeQuality &&
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
