// Banc du lot M3a « hiérarchie de transformations et caméra maison » : sdk-core contre Three.js.
//
// 1. Équivalence au bit près : de vraies chaînes d'`Object3D` et de caméras rejouées opération par
//    opération des deux côtés (`hierarchieRejeuThree.mjs`, `hierarchieRejeuNous.mjs`) — chaînes figées hostiles, scène vivante qui
//    bouge image après image, `lookAt` et projections dégénérées. Un seul écart et le script échoue.
// 2. Performance : mise à jour de hiérarchies de 1 000, 10 000 et 100 000 nœuds (tout sale, 1 % sale,
//    une racine qui bouge), lecture des positions monde, caméra par image. Nanosecondes et octets par
//    opération, médiane et p95, rapport Three / nous. Elle tourne TOUJOURS dans un processus Node
//    neuf (`bancProcessusNeuf.mjs`, mécanisme de `socle-math.bench.mjs`) : le rejeu d'équivalence
//    appelle le socle avec toutes sortes de formes d'entrée, et mesurer dans le même processus
//    chronométrerait ce passé plutôt que l'appel réel (`lookAt` : 0,98× pollué, 1,33× en processus
//    neuf, lot perf-2).
//
//   node --expose-gc --experimental-strip-types packages/sdk-browser/bench/hierarchie.bench.mjs
//
// `HIERARCHIE_REPETITIONS` (20 par défaut, jamais moins pour une campagne), `HIERARCHIE_CHAUFFE` (5) et
// `HIERARCHIE_SORTIE` (chemin du JSON, sinon `.mesure/out/calculs/hierarchie-m3a-<date>.json`).
import { rejoueEnProcessusNeuf } from '../../sdk-core/bench/bancProcessusNeuf.mjs';

if (process.env.HIERARCHIE_PARTIE === 'performance') {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { RACINE } = await import('../../sdk-core/bench/banc.mjs');
  const { groupesHierarchie } = await import('./hierarchiePerf.mjs');
  const { groupesCamera } = await import('./hierarchiePerfCamera.mjs');
  const { enTete, mesureLigne, tableau } = await import('./volumesMesure.mjs');

  const repetitions = Math.max(1, Number(process.env.HIERARCHIE_REPETITIONS ?? 20));
  const chauffe = Math.max(0, Number(process.env.HIERARCHIE_CHAUFFE ?? 5));
  const entete = enTete(repetitions, chauffe);
  const performance = [];
  // Une taille à la fois : les cent mille `Object3D` d'une taille sont libérés avant la suivante.
  for (const groupes of [groupesHierarchie(), groupesCamera()])
    for (const groupe of groupes)
      for (const l of groupe) performance.push(mesureLigne(l, repetitions, chauffe));
  console.log(tableau(entete, performance));
  const sortie =
    process.env.HIERARCHIE_SORTIE ??
    join(RACINE, '.mesure', 'out', 'calculs', `hierarchie-m3a-${entete.date.slice(0, 10)}.json`);
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(sortie, `${JSON.stringify({ entete, performance }, null, 2)}\n`);
  console.log(`JSON : ${sortie}`);
} else {
  const { compare } = await import('../../sdk-core/bench/banc.mjs');
  const { verifieEtDeposeFormules } = await import('../../sdk-core/bench/bancFormules.mjs');
  const { joueNous } = await import('./hierarchieRejeuNous.mjs');
  const { joueThree } = await import('./hierarchieRejeuThree.mjs');
  const { chainesFigees } = await import('./hierarchieScenarios.mjs');
  const { objectifs, visees } = await import('./hierarchieScenariosCamera.mjs');
  const { marquages, scenarioVivant } = await import('./hierarchieScenariosVivants.mjs');

  const options = { chauffe: 1, tours: 3, budgetMs: 500 };
  /** Un cas : un scénario, dont la taille est le nombre d'opérations rejouées. */
  const cas = (nom, scenario) => ({ nom, entree: scenario, taille: scenario.length });
  const ligne = (calcul, fichier, liste) => ({
    calcul,
    fichier,
    cas: liste,
    reference: joueThree,
    optimisee: joueNous,
  });
  const lignes = [
    ligne(
      'hiérarchie figée : mise à jour, lectures monde, images',
      'packages/sdk-core/mathTransformTreeUpdate.ts',
      [
        cas('chaînes hiérarchiques hostiles finies', chainesFigees(false)),
        cas('chaînes hiérarchiques hostiles avec NaN et infinis', chainesFigees(true)),
      ],
    ),
    ligne(
      'hiérarchie vivante : poses, reparentage, retraits, mises à jour partielles',
      'packages/sdk-core/mathTransformTreeStructure.ts',
      [
        cas('scène hiérarchique vivante ordinaire', scenarioVivant(160, 240, 1e9)),
        cas('scène hiérarchique vivante hostile', scenarioVivant(90, 160, 12)),
        cas('règles de marquage hiérarchiques', marquages()),
      ],
    ),
    ligne(
      'lookAt de caméra et d’objet, hiérarchies comprises',
      'packages/sdk-core/mathTransformTreeLookAt.ts',
      [cas('visées hiérarchiques', visees())],
    ),
    ligne('projections et images de caméra', 'packages/sdk-core/mathCamera.ts', [
      cas('objectifs', objectifs()),
    ]),
  ];

  const equivalence = [];
  for (const l of lignes) equivalence.push(await compare({ ...l, options }));
  verifieEtDeposeFormules(
    'hierarchie',
    'la hiérarchie et la caméra de sdk-core rendent exactement ce que rend Three.js',
    equivalence,
  );
  rejoueEnProcessusNeuf(import.meta.url, 'HIERARCHIE_PARTIE');
}
