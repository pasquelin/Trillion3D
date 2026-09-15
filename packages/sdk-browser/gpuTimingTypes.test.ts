// Lot formules communes : nanosecondsToMs, factorisée de 4 copies (chronomètres WebGPU et WebGL2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { nanosecondsToMs } from './gpuTimingTypes.ts';

test('nanosecondsToMs divise par un million', () => {
  assert.equal(nanosecondsToMs(1_000_000), 1);
  assert.equal(nanosecondsToMs(16_666_667), 16.666667);
});

test('nanosecondsToMs rend zéro pour zéro et une valeur négative pour un intervalle négatif', () => {
  assert.equal(nanosecondsToMs(0), 0);
  assert.equal(nanosecondsToMs(-2_000_000), -2);
});

test('nanosecondsToMs se propage en NaN ou Infinity sans planter', () => {
  assert.ok(Number.isNaN(nanosecondsToMs(NaN)));
  assert.equal(nanosecondsToMs(Infinity), Infinity);
});
