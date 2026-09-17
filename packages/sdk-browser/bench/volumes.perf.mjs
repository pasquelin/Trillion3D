// Banc des volumes : sdk-core contre Three.js.
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { casBoites } from './appui/volumesCasBoites.mjs';
import { casTronc } from './appui/volumesCasTronc.mjs';
import { boxEmpty } from '../../sdk-core/index.ts';

const options = { chauffe: 1, tours: 10, budgetMs: 500 };
const tousLesCas = [...casBoites, ...casTronc];

// Un calcul sans `reference` est mesuré sans oracle, et sa ligne publie le `motif` qui dit
// pourquoi et où sa justesse est tenue : elle n'est jamais simplement tue.
const resultats = [];
for (const item of tousLesCas) {
  resultats.push(
    await mesure({
      nom: item.calcul,
      fichier: item.fichier,
      cas: item.cas,
      calcul: item.optimisee,
      attendu: item.reference,
      motif: item.motif,
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
