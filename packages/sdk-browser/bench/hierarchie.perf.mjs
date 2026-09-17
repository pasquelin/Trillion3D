// Banc de performance : hiérarchie de transformations et caméra (sdk-core contre Three.js).
import { compare, rapport } from '../../sdk-core/bench/mesure.mjs';
import { joueNous } from './hierarchieRejeuNous.mjs';
import { joueThree } from './hierarchieRejeuThree.mjs';
import { chainesFigees } from './hierarchieScenarios.mjs';
import { objectifs, visees } from './hierarchieScenariosCamera.mjs';
import { marquages, scenarioVivant } from './hierarchieScenariosVivants.mjs';

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
