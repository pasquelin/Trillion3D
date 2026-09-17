// Banc du lot M3a « hiérarchie de transformations et caméra maison » : sdk-core contre Three.js.
import { RACINE, compare, rejoueEnProcessusNeuf, rapport } from '../../sdk-core/bench/mesure.mjs';

if (process.env.HIERARCHIE_PARTIE === 'performance') {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { groupesHierarchie } = await import('./hierarchiePerf.mjs');
  const { groupesCamera } = await import('./hierarchiePerfCamera.mjs');
  const { enTete, mesureLigne, tableau } = await import('./volumesMesure.mjs');

  const repetitions = Math.max(1, Number(process.env.HIERARCHIE_REPETITIONS ?? 20));
  const chauffe = Math.max(0, Number(process.env.HIERARCHIE_CHAUFFE ?? 5));
  const entete = enTete(repetitions, chauffe);
  const performance = [];
  for (const groupes of [groupesHierarchie(), groupesCamera()])
    for (const groupe of groupes)
      for (const l of groupe) performance.push(mesureLigne(l, repetitions, chauffe));
  console.log(tableau(entete, performance));
  const sortie =
    process.env.HIERARCHIE_SORTIE ??
    join(RACINE, '.mesure', 'out', 'calculs', `hierarchie-m3a-${entete.date.slice(0, 10)}.json`);
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, `${JSON.stringify({ entete, performance }, null, 2)}\n`);
} else {
  const { joueNous } = await import('./hierarchieRejeuNous.mjs');
  const { joueThree } = await import('./hierarchieRejeuThree.mjs');
  const { chainesFigees } = await import('./hierarchieScenarios.mjs');
  const { objectifs, visees } = await import('./hierarchieScenariosCamera.mjs');
  const { marquages, scenarioVivant } = await import('./hierarchieScenariosVivants.mjs');

  const options = { chauffe: 1, tours: 3, budgetMs: 500 };
  const cas = (nom, scenario) => ({ nom, entree: scenario, taille: scenario.length });
  const ligne = (calcul, fichier, liste) => ({
    calcul,
    fichier,
    cas: liste,
    reference: joueThree,
    optimisee: joueNous,
    options,
  });

  const equivalence = [];
  for (const c of [
    ligne('chaînes de transformations figées', 'packages/sdk-core/hierarchyNode.ts', [
      cas('cinq chaînes hostiles', chainesFigees()),
    ]),
    ligne('scénario vivant image après image', 'packages/sdk-core/hierarchyNode.ts', [
      cas('quarante images vivantes', scenarioVivant()),
    ]),
    ligne('arbre avec marquages et suppressions', 'packages/sdk-core/hierarchyNode.ts', [
      cas('marquages et suppressions', marquages()),
    ]),
    ligne('objectifs de caméra', 'packages/sdk-core/hierarchyCamera.ts', [
      cas('objectifs hostiles', objectifs()),
    ]),
    ligne('visées de caméra dégénérées', 'packages/sdk-core/hierarchyCamera.ts', [
      cas('visées dégénérées', visees()),
    ]),
  ])
    equivalence.push(await compare(c));

  rapport(
    'hierarchie',
    equivalence,
    'chaque opération de hiérarchie et de caméra rend exactement les bits de Three.js',
  );
  rejoueEnProcessusNeuf(import.meta.url, 'HIERARCHIE_PARTIE');
}
