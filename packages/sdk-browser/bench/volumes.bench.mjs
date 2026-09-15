// Banc des volumes du lot M2 : sdk-core contre Three.js, en deux parties.
//
// 1. Équivalence au bit près, cas hostiles et hiérarchies parent/enfant compris. Un seul écart et le
//    script échoue. Sous `node --test` (`npm run bench:calculs`), c'est la seule partie jouée : elle
//    dépose ses lignes avec les formules communes.
// 2. Performance, jouée quand le script est lancé seul : même travail des deux côtés, opération seule,
//    lots de 1 000, 10 000 et 100 000, et l'image — plans une fois puis tous les tests. Nanosecondes
//    et octets par opération, médiane et p95, rapport Three / nous ; tableau en console et JSON.
//
//   node --expose-gc --experimental-strip-types packages/sdk-browser/bench/volumes.bench.mjs
//
// `VOLUMES_REPETITIONS` (20 par défaut, jamais moins pour une campagne), `VOLUMES_CHAUFFE` (5) et
// `VOLUMES_SORTIE` (chemin du JSON, sinon `orchestration/mesures/volumes-m2-<date>.json`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RACINE, compare } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeFormules } from '../../sdk-core/bench/bancFormules.mjs';
import { casBoites } from './volumesCasBoites.mjs';
import { casTronc } from './volumesCasTronc.mjs';
import { enTete, mesureLigne, tableau } from './volumesMesure.mjs';
import { lignesDePerformance } from './volumesPerf.mjs';

const sousNodeTest = !!process.env.NODE_TEST_CONTEXT;
/** Le chronomètre de `compare` ne sert à rien ici : un seul tour, l'égalité seule compte. */
const unTour = { chauffe: 0, tours: 1, budgetMs: 0 };
const options = sousNodeTest ? { chauffe: 2, tours: 10, budgetMs: 500 } : unTour;

const equivalence = [];
for (const cas of [...casBoites, ...casTronc]) equivalence.push(await compare({ ...cas, options }));
const casJoues = equivalence.reduce(
  (total, ligne) => total + ligne.entrees.reduce((n, entree) => n + (entree.taille ?? 0), 0),
  0,
);
const casHierarchiques = equivalence.reduce(
  (total, ligne) =>
    total +
    ligne.entrees
      .filter((entree) => entree.nom.includes('hiérarchi'))
      .reduce((n, entree) => n + (entree.taille ?? 0), 0),
  0,
);

if (sousNodeTest) {
  verifieEtDeposeFormules(
    'volumes',
    'chaque volume de sdk-core rend exactement ce que rend Three.js, hiérarchies comprises',
    equivalence,
  );
} else {
  const ecarts = equivalence.filter((ligne) => ligne.difference);
  console.log(
    `Équivalence : ${equivalence.length} lignes, ${casJoues} cas dont ${casHierarchiques} hiérarchiques, ${
      ecarts.length
    } écart(s).`,
  );
  if (ecarts.length)
    throw new Error(ecarts.map((ligne) => `${ligne.calcul} : ${ligne.difference}`).join('\n'));

  const repetitions = Math.max(1, Number(process.env.VOLUMES_REPETITIONS ?? 20));
  const chauffe = Math.max(0, Number(process.env.VOLUMES_CHAUFFE ?? 5));
  const entete = enTete(repetitions, chauffe);
  const performance = lignesDePerformance().map((ligne) =>
    mesureLigne(ligne, repetitions, chauffe),
  );
  console.log(tableau(entete, performance));
  const sortie =
    process.env.VOLUMES_SORTIE ??
    join(RACINE, 'orchestration', 'mesures', `volumes-m2-${entete.date.slice(0, 10)}.json`);
  mkdirSync(dirname(sortie), { recursive: true });
  writeFileSync(
    sortie,
    `${JSON.stringify(
      {
        entete,
        equivalence: {
          lignes: equivalence.map(({ calcul, fichier, identique, difference, entrees }) => ({
            calcul,
            fichier,
            identique,
            difference,
            entrees,
          })),
          cas: casJoues,
          casHierarchiques,
        },
        performance,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`JSON : ${sortie}`);
}
