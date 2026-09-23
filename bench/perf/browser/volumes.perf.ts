// Volume bench: sdk-core against Three.js.
import { stress, rapport } from '../../core/index.ts';
import { casBoites } from './support/volumesCasBoites.ts';
import { casTronc } from './support/volumesCasTronc.ts';
import { boxEmpty } from '../../../packages/sdk-core/src/index.ts';

const options = { chauffe: 1, tours: 10, budgetMs: 500 };
const tousLesCas = [...casBoites, ...casTronc];

// A computation without `reference` is measured without an oracle, and its line publishes the
// `motif` that says why and where its correctness is held: it is never simply silenced.
const resultats = [];
for (const item of tousLesCas) resultats.push(await item.run(options));

await stress({
  name: 'boxEmpty extremes',
  calcul: () => {
    const b = new Float64Array(6);
    boxEmpty(b, 0);
    return b;
  },
  extremes: [{ name: 'appel', input: null }],
});

rapport(
  'volumes',
  resultats,
  'each sdk-core volume yields exactly what Three.js yields, hierarchies included',
);
