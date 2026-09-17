// Banc de performance : planification d'atlas d'ombres et tranches de lampes.
import { createSceneLightStore } from '../sceneLightStore.ts';
import { createShadowPlan } from '../sceneLightShadowPlan.ts';
import { mesure, rapport } from './mesure.mjs';

const VUE = {
  position: [0, 0, 0],
  forward: [0, 0, -1],
  halfFovY: 0.9,
  aspect: 1,
  near: 0.1,
  far: 100,
};

function creeScenario(nbLampes) {
  const store = createSceneLightStore();
  const plan = createShadowPlan(64);
  for (let i = 0; i < nbLampes; i++) {
    store.add({
      id: `lampe-${i}`,
      kind: 'point',
      position: [(i % 8) * 2 - 8, 1, -5 - Math.floor(i / 8) * 2],
      color: [1, 1, 1],
      intensity: 10,
      range: 8,
      castsShadow: true,
    });
  }
  return { store, plan, nbLampes };
}

const scenario1 = creeScenario(1);
const scenario8 = creeScenario(8);
const scenario32 = creeScenario(32);

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesurePlan = await mesure({
  nom: 'planification atlas ombres',
  fichier: 'packages/sdk-core/sceneLightShadowPlan.ts',
  cas: [
    { nom: '1 lampe ponctuelle', entree: scenario1, taille: 1 },
    { nom: '8 lampes ponctuelles en grille', entree: scenario8, taille: 8 },
    { nom: '32 lampes ponctuelles sous budget', entree: scenario32, taille: 32 },
  ],
  calcul: ({ store, plan, nbLampes }) => {
    let tranchesAttribuees = 0;
    for (let image = 0; image < 4; image++) {
      plan.plan(store, VUE, image, image * 16);
      for (let i = 0; i < nbLampes; i++) {
        const slot = store.slotOf(`lampe-${i}`);
        if (slot >= 0 && store.sliceOf(slot) >= 0) tranchesAttribuees++;
      }
    }
    return tranchesAttribuees;
  },
  attendu: ({ nbLampes }) => nbLampes * 4,
  options,
});

rapport(
  'plan-ombres',
  mesurePlan,
  'chaque lampe à ombre obtient une tranche d’atlas valide à chaque image',
);
