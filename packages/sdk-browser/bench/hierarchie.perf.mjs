// Banc de performance : hiérarchie de transformations et caméra (sdk-core contre Three.js).
// De vraies chaînes d'`Object3D` et de caméras, rejouées opération par opération des deux côtés —
// chaînes figées hostiles, valeurs non finies, scène vivante qui bouge image après image, `lookAt`
// et projections dégénérées. Un seul bit d'écart et le banc tombe.
import { compare, rapport } from '../../sdk-core/bench/socle.mjs';
import { joueNous } from './appui/hierarchieRejeuNous.mjs';
import { joueThree } from './appui/hierarchieRejeuThree.mjs';
import { chainesFigees } from './appui/hierarchieScenarios.mjs';
import { objectifs, visees } from './appui/hierarchieScenariosCamera.mjs';
import { marquages, scenarioVivant } from './appui/hierarchieScenariosVivants.mjs';

const options = { chauffe: 1, tours: 3, budgetMs: 500 };
/** Un cas : un scénario, dont la taille est le nombre d'opérations rejouées. */
const cas = (nom, scenario) => ({ nom, entree: scenario, taille: scenario.length });
const ligne = (nom, fichier, liste) => ({
  nom,
  fichier,
  cas: liste,
  reference: joueThree,
  optimisee: joueNous,
  options,
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
for (const l of lignes) equivalence.push(await compare(l));

rapport(
  'hierarchie',
  equivalence,
  'la hiérarchie et la caméra de sdk-core rendent exactement ce que rend Three.js',
);
