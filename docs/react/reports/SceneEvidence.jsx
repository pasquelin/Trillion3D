import { SceneNotice } from './SceneNotice.jsx';
import { useState } from 'react';
import { ImageCard } from '../components/ImageCard.jsx';
import { Modal } from '../components/Modal.jsx';
import { Card, Select } from '../components/UI.jsx';
import { Section } from '../components/Section.jsx';
import { Tabs } from '../components/Tabs.jsx';
import { pairedImages, sceneName, runOf } from '../../js/reports/presentation.js';
import { engineName, runName, viewName } from '../../js/reports/names.js';
import { Evidence } from './Evidence.jsx';
const FAMILIES = [
  ['engines', 'Engines', 'Moteurs'],
  ['drawing', 'Drawing methods', 'Méthodes de dessin'],
  ['lighting', 'Lighting', 'Éclairage'],
  ['single', 'Individual captures', 'Captures seules'],
];
function family(name) {
  if (/lamp|ombre/.test(name)) return 'lighting';
  return name.startsWith('three-') ? 'engines' : 'drawing';
}
function CaptureGroups({ report, locale, pairs, singles, name }) {
  const fr = locale === 'fr';
  const engines = pairs.length > 0 && pairs.every(([a]) => family(runOf(report, a)) === 'engines');
  return (
    <>
      <p>
        {fr
          ? engines
            ? 'Comparé à Web Geometry. Déplacez la poignée pour comparer les images.'
            : singles.length
              ? 'Captures individuelles : aucune image de comparaison n’a été enregistrée pour ces vues.'
              : 'Déplacez la poignée sur chaque image pour comparer les deux rendus.'
          : engines
            ? 'Compared with Web Geometry. Move the handle to compare images.'
            : singles.length
              ? 'Individual captures: no comparison image was recorded for these views.'
              : 'Move the handle on each image to compare both renders.'}
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {pairs
          .filter(([a]) => runOf(report, a) === name)
          .map(([a, b]) => (
            <Card surface="nested" key={a.differencePair}>
              <Evidence {...{ a, b, locale }} campaign={report.id} />
              <Modal
                imageOnly
                title={`${sceneName(a.scene)} · ${viewName(a.view, locale)}`}
                triggerLabel={fr ? 'Agrandir' : 'Enlarge'}
                closeLabel={fr ? 'Fermer' : 'Close'}
              >
                {() => <Evidence imageOnly {...{ a, b, locale }} campaign={report.id} />}
              </Modal>
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
              enlargeLabel={fr ? 'Agrandir' : 'Enlarge'}
              closeLabel={fr ? 'Fermer' : 'Close'}
            />
          ))}
      </div>
    </>
  );
}
export function SceneEvidence({ report, scene, locale }) {
  const [selected, setSelected] = useState('engines');
  const [chosenRun, setChosenRun] = useState('');
  const records = report.records.filter((r) => r.scene === scene);
  const pairs = pairedImages(records),
    paired = new Set(pairs.flat().map((r) => r.id));
  const singles = records.filter((r) => r.image && !paired.has(r.id));
  const groups = FAMILIES.map(([id, en, fr]) => ({
    id,
    label: locale === 'fr' ? fr : en,
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
  function choiceLabel(run) {
    const record = active.pairs.find(([a]) => runOf(report, a) === run)?.[0];
    return active.id === 'engines' && record
      ? `${engineName(record.engine)} · ${record.canvas?.width ?? '—'} × ${record.canvas?.height ?? '—'}`
      : runName(run, locale);
  }
  return (
    <Section title={sceneName(scene)}>
      <SceneNotice
        note={report.records.find((r) => r.scene === scene && r.sceneNote)?.sceneNote}
        locale={locale}
      />
      <Tabs
        sticky
        label={locale === 'fr' ? 'Type de comparaison visuelle' : 'Visual comparison type'}
        value={selected}
        onChange={(id) => {
          setSelected(id);
          setChosenRun('');
        }}
        accessory={
          <div className="w-60 max-w-full">
            <Select
              size="sm"
              aria-label={locale === 'fr' ? 'Essai' : 'Experiment'}
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
    </Section>
  );
}
