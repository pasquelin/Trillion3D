// Banc du lot M3a « hiérarchie de transformations et caméra maison » : sdk-core contre Three.js.
//
// 1. Équivalence au bit près : de vraies chaînes d'`Object3D` et de caméras rejouées opération par
//    opération des deux côtés (`hierarchieRejeuThree.mjs`, `hierarchieRejeuNous.mjs`) — chaînes figées hostiles, scène vivante qui
//    bouge image après image, `lookAt` et projections dégénérées. Un seul écart et le script échoue.
//    Sous `node --test` (`npm run bench:calculs`), seule cette partie est jouée et déposée.
// 2. Performance, quand le script est lancé seul : mise à jour de hiérarchies de 1 000, 10 000 et
//    100 000 nœuds (tout sale, 1 % sale, une racine qui bouge), lecture des positions monde, caméra
//    par image. Nanosecondes et octets par opération, médiane et p95, rapport Three / nous.
//
//   node --expose-gc --experimental-strip-types packages/sdk-browser/bench/hierarchie.bench.mjs
//
// `HIERARCHIE_REPETITIONS` (20 par défaut, jamais moins pour une campagne), `HIERARCHIE_CHAUFFE` (5) et
// `HIERARCHIE_SORTIE` (chemin du JSON, sinon `.mesure/out/calculs/hierarchie-m3a-<date>.json`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RACINE, compare } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeFormules } from '../../sdk-core/bench/bancFormules.mjs';
import { groupesHierarchie } from './hierarchiePerf.mjs';
import { groupesCamera } from './hierarchiePerfCamera.mjs';
import { joueNous } from './hierarchieRejeuNous.mjs';
import { joueThree } from './hierarchieRejeuThree.mjs';
import { chainesFigees } from './hierarchieScenarios.mjs';
import { objectifs, visees } from './hierarchieScenariosCamera.mjs';
import { marquages, scenarioVivant } from './hierarchieScenariosVivants.mjs';
import { enTete, mesureLigne, tableau } from './volumesMesure.mjs';

const sousNodeTest = !!process.env.NODE_TEST_CONTEXT;
/** Hors `node --test`, le chronomètre de `compare` ne sert à rien : un tour, l'égalité seule compte. */
const options = sousNodeTest
  ? { chauffe: 1, tours: 3, budgetMs: 500 }
  : { chauffe: 0, tours: 1, budgetMs: 0 };

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
const somme = (retenue) =>
  equivalence.reduce(
    (total, l) => total + l.entrees.filter(retenue).reduce((n, e) => n + e.taille, 0),
    0,
  );
const operations = somme(() => true),
  hierarchiques = somme((e) => e.nom.includes('hiérarchi'));

if (sousNodeTest) {
  verifieEtDeposeFormules(
    'hierarchie',
    'la hiérarchie et la caméra de sdk-core rendent exactement ce que rend Three.js',
    equivalence,
  );
} else {
  const ecarts = equivalence.filter((l) => l.difference);
  console.log(
    `Équivalence : ${equivalence.length} lignes, ${operations} opérations dont ${hierarchiques} hiérarchiques, ${ecarts.length} écart(s).`,
  );
  if (ecarts.length) throw new Error(ecarts.map((l) => `${l.calcul} : ${l.difference}`).join('\n'));

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
  const lignesEquivalence = equivalence.map(
    ({ calcul, fichier, identique, difference, entrees }) => ({
      calcul,
      fichier,
      identique,
      difference,
      entrees,
    }),
  );
  const rapport = {
    entete,
    equivalence: { lignes: lignesEquivalence, operations, hierarchiques },
    performance,
  };
  writeFileSync(sortie, `${JSON.stringify(rapport, null, 2)}\n`);
  console.log(`JSON : ${sortie}`);
}
