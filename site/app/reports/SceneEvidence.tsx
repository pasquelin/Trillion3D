import { useState } from 'react';
import { useWords } from '../i18n.ts';
import { SceneNotice } from './SceneNotice.tsx';
import { ImageCard } from '../ui/ImageCard.tsx';
import { ModalTrigger } from '../ui/Modal.tsx';
import { Card } from '../ui/Card.tsx';
import { Select } from '../ui/Input.tsx';
import { Tabs } from '../ui/Tabs.tsx';
import { pairedImages, sceneName, runOf } from '../../reports/presentation.ts';
import { engineName, runName, viewName } from '../../reports/names.ts';
import { Evidence } from './Evidence.tsx';
import type { Report, ReportRecord } from '../../reports/types.ts';
import type { Locale } from '../../content/locale.ts';

interface SceneEvidenceProps {
  report: Report;
  scene: string;
  locale: Locale;
}

/** The kinds of capture, in tab order; each is named by `report.families.<id>`. */
const FAMILIES = ['engines', 'drawing', 'lighting', 'single'] as const;

function family(name: string): string {
  if (/lamp|ombre/.test(name)) return 'lighting';
  return name.startsWith('three-') ? 'engines' : 'drawing';
}

interface CaptureGroupsProps {
  report: Report;
  locale: Locale;
  pairs: [ReportRecord, ReportRecord][];
  singles: ReportRecord[];
  name: string;
}

function CaptureGroups({ report, locale, pairs, singles, name }: CaptureGroupsProps) {
  const t = useWords(locale);
  const engines = pairs.length > 0 && pairs.every(([a]) => family(runOf(report, a)) === 'engines');
  return (
    <>
      <p>
        {t(
          engines
            ? 'report.comparedEngines'
            : singles.length
              ? 'report.singlesOnly'
              : 'report.compareHandle',
        )}
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        {pairs
          .filter(([a]) => runOf(report, a) === name)
          .map(([a, b]) => (
            <Card surface="nested" key={a.differencePair}>
              <Evidence {...{ a, b, locale }} campaign={report.id} />
              <ModalTrigger
                size="image"
                title={`${sceneName(a.scene)} · ${viewName(a.view, locale)}`}
                label={t('report.enlarge')}
                closeLabel={t('actions.close')}
              >
                <Evidence imageOnly {...{ a, b, locale }} campaign={report.id} />
              </ModalTrigger>
            </Card>
          ))}
        {singles
          .filter((r) => runOf(report, r) === name)
          .map((r) => (
            <ImageCard
              key={r.id}
              title={`${viewName(r.view, locale)} · ${r.quality} px · ${engineName(r.engine)}`}
              src={`reports/${report.id}/${r.image}`}
              alt={`${sceneName(r.scene)} · ${viewName(r.view, locale)}`}
              enlargeLabel={t('report.enlarge')}
              closeLabel={t('actions.close')}
            />
          ))}
      </div>
    </>
  );
}

export function SceneEvidence({ report, scene, locale }: SceneEvidenceProps) {
  const t = useWords(locale);
  const [selected, setSelected] = useState('engines');
  const [chosenRun, setChosenRun] = useState('');
  const records = report.records.filter((r) => r.scene === scene);
  const pairs = pairedImages(records);
  const paired = new Set(pairs.flat().map((r) => r.id));
  const singles = records.filter((r) => r.image && !paired.has(r.id));
  const groups = FAMILIES.map((id) => ({
    id,
    label: t(`report.families.${id}`),
    pairs: pairs.filter(([a]) => family(runOf(report, a)) === id),
    singles: id === 'single' ? singles : [],
  })).filter((group) => group.pairs.length || group.singles.length);
  const active = groups.find((group) => group.id === selected) ?? groups[0];
  if (!active) return null;
  const names = [
    ...new Set([
      ...active.pairs.map(([a]) => runOf(report, a)),
      ...active.singles.map((r) => runOf(report, r)),
    ]),
  ];
  const name = names.includes(chosenRun) ? chosenRun : names[0];
  function choiceLabel(run: string) {
    const record = active.pairs.find(([a]) => runOf(report, a) === run)?.[0];
    return active.id === 'engines' && record
      ? `${engineName(record.engine)} · ${record.canvas?.width ?? '—'} × ${record.canvas?.height ?? '—'}`
      : runName(run, locale);
  }
  return (
    <Card title={sceneName(scene)}>
      <SceneNotice
        note={report.records.find((r) => r.scene === scene && r.sceneNote)?.sceneNote}
        locale={locale}
      />
      <Tabs
        sticky
        label={t('report.comparisonType')}
        value={selected}
        onChange={(id) => {
          setSelected(id);
          setChosenRun('');
        }}
        accessory={
          <div className="w-60 max-w-full">
            <Select
              size="sm"
              aria-label={t('report.experiment')}
              value={name}
              onChange={(event) => setChosenRun(event.target.value)}
            >
              {names.map((run) => (
                <option key={run} value={run}>
                  {choiceLabel(run)}
                </option>
              ))}
            </Select>
          </div>
        }
        items={groups.map((group) => ({
          id: group.id,
          label: group.label,
          render: () => (
            <CaptureGroups
              key={group.id}
              name={name}
              {...{ report, locale }}
              pairs={group.pairs}
              singles={group.singles}
            />
          ),
        }))}
      />
    </Card>
  );
}
