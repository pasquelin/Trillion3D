import test from 'node:test';
import assert from 'node:assert/strict';
import { TAA_WEIGHTS, taaWeights } from './taaWeights.ts';

test('les poids du filtre somment à un, pèsent le centre sans gigue et penchent du côté de l’échantillon', () => {
  const out = new Float32Array(TAA_WEIGHTS);
  taaWeights(0, 0, out, 0);
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += out[k];
  assert.ok(Math.abs(sum - 1) < 1e-6);
  // Sans gigue, le voisin à un pixel est au bord du rayon : seul le centre pèse.
  assert.ok(out[4] > 0.999, `centre ${out[4]}`);
  for (let k = 0; k < 9; k++) if (k !== 4) assert.ok(out[k] < 1e-4);
  for (let k = 9; k < TAA_WEIGHTS; k++) assert.equal(out[k], 0);
  // Gigue d'un demi-pixel vers la droite : tous les échantillons de l'image sont un demi-pixel à
  // gauche de leur centre, donc celui du voisin de droite (dx = +1) tombe à un demi-pixel de notre
  // centre, comme le nôtre — même poids —, et celui du voisin de gauche est hors du rayon.
  taaWeights(0.5, 0, out, 0);
  assert.ok(Math.abs(out[5] - out[4]) < 1e-6, `droite ${out[5]}, centre ${out[4]}`);
  assert.ok(out[3] < 1e-3);
  // Gigue vers le haut en NDC (jy > 0) : les échantillons sont plus bas à l'écran, celui du voisin
  // du haut (dy = −1, convention écran) tombe près de notre centre.
  taaWeights(0, 0.5, out, 0);
  assert.ok(Math.abs(out[1] - out[4]) < 1e-6);
  assert.ok(out[7] < 1e-3);
});
