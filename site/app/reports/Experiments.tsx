import { Section } from '../ui/Text.tsx';
import { useState } from 'react';
import { useWords } from '../i18n.ts';
import { Select } from '../ui/Input.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import { viewName, runName, engineName } from '../../reports/names.ts';
import { Card } from '../ui/Card.tsx';
import { sceneName, runOf } from '../../reports/presentation.ts';
import { MetricCharts } from './MetricCharts.tsx';
import type { Report } from '../../reports/types.ts';
import type { MetricKey } from '../../reports/metrics.ts';
import type { Dictionary } from '../../content/i18n/dictionary.ts';
import type { Locale } from '../../content/locale.ts';

interface ExperimentsProps {
  report: Report;
  scene: string;
  locale: Locale;
}

/** The kinds of experiment, each titled by `experiments.<id>`: the runs its pattern names, and
 *  the metrics it charts. */
const GROUPS: [keyof Dictionary['experiments'], RegExp, MetricKey[]][] = [
  ['resolution', /^(res-|raster-|three-(nu|lod)-1248)/, ['gpu', 'sync', 'cpu', 'triangles']],
  ['lights', /lamp|ombre|rebond|sans-lumiere/, ['gpu', 'sync', 'cpu', 'calls']],
  ['execution', /^(fixe|aa-off|profil-off|isolation|visible|math-)/, ['gpu', 'cpu', 'cadence']],
  ['memory', /./, ['gpu', 'cpu', 'geometry', 'textures', 'textureBudget', 'triangles']],
];

export function Experiments({ report, scene, locale }: ExperimentsProps) {
  const t = useWords(locale);
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
    <Card title={sceneName(scene)}>
      <Tabs
        sticky
        label={t('report.view')}
        value={selected}
        onChange={setSelected}
        accessory={
          <div className="w-24">
            <Select
              size="sm"
              aria-label={t('report.threshold')}
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
              {GROUPS.map(([group, , metrics], groupIndex) => {
                const rows = records.filter(
                  (r) =>
                    r.view === key &&
                    String(r.quality) === activeQuality &&
                    GROUPS.findIndex(([, pattern]) => pattern.test(runOf(report, r))) ===
                      groupIndex,
                );
                if (!rows.length) return null;
                return (
                  <Section level={3} key={group} title={t(`experiments.${group}`)}>
                    <MetricCharts
                      columns={1}
                      {...{ report, locale, metrics }}
                      records={rows}
                      labelRecord={(r) =>
                        `${runName(runOf(report, r), locale)} · ${r.variant === 'raster-calcul' ? t('report.computeDrawing') : engineName(r.engine)}`
                      }
                    />
                  </Section>
                );
              })}
            </>
          ),
        }))}
      />
    </Card>
  );
}
