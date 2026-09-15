// A11 : la résidence demandée est comparée à un miroir compact (un flottant par page) au lieu de
// sauter de douze flottants en douze flottants dans les cônes de page ; `maxStretch` reçoit
// désormais une sous-vue au lieu d'un tableau recopié. Oracle : la comparaison à travers les cônes,
// d'avant le lot A, dans `scripts/mesure/calculs/oracles/residence.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../sdk-core/index.ts';
import { updateResidencyFlags } from './gpuDagRuntime.ts';
import { referenceUpdateResidency } from '../../scripts/mesure/calculs/oracles/residence.mjs';

const STRIDE = 12,
  OFFSET = 11;

function conesWith(count: number, seed: (j: number) => number) {
  const cones = new Float32Array(count * STRIDE);
  for (let j = 0; j < count * STRIDE; j++) cones[j] = seed(j);
  return cones;
}

test('no page changing flags nothing, matching the reference exactly', () => {
  const next = new Uint32Array(0);
  const conesOptimisee = conesWith(0, () => 0),
    conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(0);
  assert.equal(updateResidencyFlags(next, mirror, conesOptimisee, STRIDE, OFFSET), false);
  assert.equal(referenceUpdateResidency(next, conesReference), false);
});

test('every page flips, some pages do not: same changed verdict, same cone bytes as the reference', () => {
  const count = 40;
  const next = new Uint32Array(count).map((_, j) => (j % 3 === 0 ? 0 : 1));
  const conesOptimisee = conesWith(count, (j) => (j % STRIDE === OFFSET ? 1 : 0.5));
  const conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(count);
  for (let j = 0; j < count; j++) mirror[j] = conesOptimisee[j * STRIDE + OFFSET];

  const changedOptimisee = updateResidencyFlags(next, mirror, conesOptimisee, STRIDE, OFFSET);
  const changedReference = referenceUpdateResidency(next, conesReference);
  assert.equal(changedOptimisee, changedReference);
  assert.deepEqual([...conesOptimisee], [...conesReference]);

  // A second pass with the same `next` changes nothing more: the mirror already reflects it.
  assert.equal(updateResidencyFlags(next, mirror, conesOptimisee, STRIDE, OFFSET), false);
});

test('a single page toggling on then off is reflected bit for bit, both directions', () => {
  const conesOptimisee = conesWith(1, () => 0.5),
    conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(1);
  mirror[0] = conesOptimisee[OFFSET];
  assert.equal(
    updateResidencyFlags(new Uint32Array([1]), mirror, conesOptimisee, STRIDE, OFFSET),
    true,
  );
  assert.equal(referenceUpdateResidency(new Uint32Array([1]), conesReference), true);
  assert.equal(conesOptimisee[OFFSET], conesReference[OFFSET]);
  assert.equal(
    updateResidencyFlags(new Uint32Array([0]), mirror, conesOptimisee, STRIDE, OFFSET),
    true,
  );
  assert.equal(referenceUpdateResidency(new Uint32Array([0]), conesReference), true);
  assert.equal(conesOptimisee[OFFSET], conesReference[OFFSET]);
});

test('maxStretch on a subarray view gives the same value as on the equivalent freshly built array', () => {
  const worlds = new Float32Array(32 * 16);
  for (let i = 0; i < worlds.length; i++) worlds[i] = i % 17 === 0 ? 1.5 : 0.02;
  const view = worlds.subarray(16, 32);
  const copy = Array.from(view);
  assert.ok(Object.is(maxStretch(view), maxStretch(copy)));
});

test('maxStretch rejects a non-finite world matrix the same way whatever the input type', () => {
  const bad = new Float32Array(16).fill(1);
  bad[0] = Infinity;
  assert.throws(() => maxStretch(bad));
  assert.throws(() => maxStretch(Array.from(bad)));
});
