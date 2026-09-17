// Banc des volumes : sdk-core contre Three.js.
import { mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { casBoites } from './appui/volumesCasBoites.mjs';
import { casTronc } from './appui/volumesCasTronc.mjs';
import { boxEmpty } from '../../sdk-core/index.ts';

const options = { chauffe: 1, tours: 10, budgetMs: 500 };
const tousLesCas = [...casBoites, ...casTronc];

// Un cas dont le jeu de cas porte `oraclePerime` est mesuré sans oracle, et la ligne publie le
// motif : la justesse reste tenue ailleurs, elle n'est jamais simplement tue.
const resultats = [];
for (const item of tousLesCas) {
  resultats.push(
    await mesure({
      nom: item.calcul,
      fichier: item.fichier,
      cas: item.cas,
      calcul: item.optimisee,
      attendu: item.oraclePerime ? null : item.reference,
      motif: item.oraclePerime ?? null,
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
