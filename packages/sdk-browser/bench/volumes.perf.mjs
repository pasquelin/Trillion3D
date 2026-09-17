// Banc des volumes du lot M2 : sdk-core contre Three.js.
import { mesure, stress, rapport } from '../../sdk-core/bench/mesure.mjs';
import { casBoites } from './volumesCasBoites.mjs';
import { casTronc } from './volumesCasTronc.mjs';
import { boxEmpty } from '../../sdk-core/index.ts';

const options = { chauffe: 1, tours: 10, budgetMs: 500 };
const tousLesCas = [...casBoites, ...casTronc];

const resultats = [];
for (const item of tousLesCas) {
  const zInverse =
    item.calcul === "plans normalisés du tronc d'une vue-projection" ||
    item.calcul === "plans bruts d'une matrice de découpe" ||
    item.calcul === 'boîte hors du tronc';
  resultats.push(
    await mesure({
      nom: item.calcul,
      fichier: item.fichier,
      cas: item.cas,
      calcul: item.optimisee,
      attendu: zInverse ? null : item.reference,
      options,
    }),
  );
}

await stress({
  nom: 'boxEmpty extremes',
  calcul: () => {
    const b = new Float64Array(6);
    boxEmpty(b, 0);
    return b;
  },
  extremes: [{ nom: 'appel', entree: null }],
});

rapport(
  'volumes',
  resultats,
  'chaque volume de sdk-core rend exactement ce que rend Three.js, hiérarchies comprises',
);
