import { useState } from 'react';
import { ImageCard } from '../components/ImageCard.jsx';
import { Modal } from '../components/Modal.jsx';
import { Card } from '../components/UI.jsx';
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
function CaptureGroups({ report, locale, pairs, singles }) {
  const [selected, setSelected] = useState('');
  const names = [
    ...new Set([...pairs.map(([a]) => runOf(report, a)), ...singles.map((r) => runOf(report, r))]),
  ];
  const fr = locale === 'fr';
  const engines = pairs.length > 0 && pairs.every(([a]) => family(runOf(report, a)) === 'engines');
  function choiceLabel(name) {
    const record = pairs.find(([a]) => runOf(report, a) === name)?.[0];
    if (!engines || !record) return runName(name, locale);
    return `${engineName(record.engine)} · ${record.canvas?.width ?? '—'} × ${record.canvas?.height ?? '—'}`;
  }
  return (
    <Tabs
      label={fr ? 'Essai représenté' : 'Displayed experiment'}
      value={selected}
      onChange={setSelected}
      items={names.map((name) => ({
        id: name,
        label: choiceLabel(name),
        render: () => (
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
        ),
      }))}
    />
  );
}
export function SceneEvidence({ report, scene, locale }) {
  const [selected, setSelected] = useState('engines');
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
  return (
    <Section title={sceneName(scene)}>
      <Tabs
        label={locale === 'fr' ? 'Type de comparaison visuelle' : 'Visual comparison type'}
        value={selected}
        onChange={setSelected}
        items={groups.map((group) => ({
          id: group.id,
          label: group.label,
          render: () => (
            <CaptureGroups
              key={group.id}
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
