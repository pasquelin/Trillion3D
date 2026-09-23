import test from 'node:test';
import assert from 'node:assert/strict';
import { TAA_WEIGHTS, taaWeights } from './weights.ts';

test('filter weights sum to one, weigh the centre without jitter and lean toward the sample', () => {
  const out = new Float32Array(TAA_WEIGHTS);
  taaWeights(0, 0, out, 0);
  let sum = 0;
  for (let k = 0; k < 9; k++) sum += out[k];
  assert.ok(Math.abs(sum - 1) < 1e-6);
  // Without jitter, the neighbour one pixel away is at the edge of the radius: only the centre weighs.
  assert.ok(out[4] > 0.999, `centre ${out[4]}`);
  for (let k = 0; k < 9; k++) if (k !== 4) assert.ok(out[k] < 1e-4);
  for (let k = 9; k < TAA_WEIGHTS; k++) assert.equal(out[k], 0);
  // Half-pixel jitter to the right: every sample of the image is half a pixel left of its
  // centre, so the right neighbour's (dx = +1) falls half a pixel from our centre, like ours —
  // same weight — and the left neighbour's is outside the radius.
  taaWeights(0.5, 0, out, 0);
  assert.ok(Math.abs(out[5] - out[4]) < 1e-6, `right ${out[5]}, centre ${out[4]}`);
  assert.ok(out[3] < 1e-3);
  // Jitter upward in NDC (jy > 0): samples are lower on screen, the top neighbour's (dy = −1,
  // screen convention) falls near our centre.
  taaWeights(0, 0.5, out, 0);
  assert.ok(Math.abs(out[1] - out[4]) < 1e-6);
  assert.ok(out[7] < 1e-3);
});
