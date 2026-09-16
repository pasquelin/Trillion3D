// A11 : la résidence demandée est comparée à un miroir compact (un flottant par page) au lieu de
// sauter de douze flottants en douze flottants dans les cônes de page ; `maxStretch` reçoit
// désormais une sous-vue au lieu d'un tableau recopié. Oracle : la comparaison à travers les cônes,
// d'avant le lot A, dans `bench/oracles/residence.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../sdk-core/index.ts';
import { updateResidencyFlags } from './gpuDagRuntime.ts';
import { referenceUpdateResidency } from './bench/oracles/residence.mjs';

const STRIDE = 12,
  OFFSET = 11;

function conesWith(count: number, seed: (j: number) => number) {
  const cones = new Float32Array(count * STRIDE);
  for (let j = 0; j < count * STRIDE; j++) cones[j] = seed(j);
  return cones;
}

/**
 * Le balayage complet, tel que l'oracle le fait : sans journal de rangs, toutes les pages sont
 * relues. `updateResidencyFlags` rend le nombre de pages retenues et les nomme dans `touched` ; le
 * verdict que l'oracle rend est ce nombre ramené à un booléen.
 */
function balayage(next: Uint32Array, mirror: Float32Array, cones: Float32Array) {
  const touched = new Int32Array(Math.max(1, next.length));
  const count = updateResidencyFlags(next, mirror, cones, STRIDE, OFFSET, undefined, touched);
  for (let i = 1; i < count; i++)
    assert.ok(touched[i] > touched[i - 1], 'les index retenus sont croissants');
  return { changed: count > 0, count, touched: touched.slice(0, count) };
}

test('no page changing flags nothing, matching the reference exactly', () => {
  const next = new Uint32Array(0);
  const conesOptimisee = conesWith(0, () => 0),
    conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(0);
  assert.equal(balayage(next, mirror, conesOptimisee).changed, false);
  assert.equal(referenceUpdateResidency(next, conesReference), false);
});

test('every page flips, some pages do not: same changed verdict, same cone bytes as the reference', () => {
  const count = 40;
  const next = new Uint32Array(count).map((_, j) => (j % 3 === 0 ? 0 : 1));
  const conesOptimisee = conesWith(count, (j) => (j % STRIDE === OFFSET ? 1 : 0.5));
  const conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(count);
  for (let j = 0; j < count; j++) mirror[j] = conesOptimisee[j * STRIDE + OFFSET];

  const optimisee = balayage(next, mirror, conesOptimisee);
  const changedReference = referenceUpdateResidency(next, conesReference);
  assert.equal(optimisee.changed, changedReference);
  assert.deepEqual([...conesOptimisee], [...conesReference]);

  // A second pass with the same `next` changes nothing more: the mirror already reflects it.
  assert.equal(balayage(next, mirror, conesOptimisee).changed, false);
});

test('a single page toggling on then off is reflected bit for bit, both directions', () => {
  const conesOptimisee = conesWith(1, () => 0.5),
    conesReference = conesOptimisee.slice();
  const mirror = new Float32Array(1);
  mirror[0] = conesOptimisee[OFFSET];
  assert.equal(balayage(new Uint32Array([1]), mirror, conesOptimisee).changed, true);
  assert.equal(referenceUpdateResidency(new Uint32Array([1]), conesReference), true);
  assert.equal(conesOptimisee[OFFSET], conesReference[OFFSET]);
  assert.equal(balayage(new Uint32Array([0]), mirror, conesOptimisee).changed, true);
  assert.equal(referenceUpdateResidency(new Uint32Array([0]), conesReference), true);
  assert.equal(conesOptimisee[OFFSET], conesReference[OFFSET]);
});

test('le journal des rangs trié pose les mêmes drapeaux que le balayage complet', () => {
  const count = 40;
  const next = new Uint32Array(count).map((_, j) => (j % 7 === 0 ? 1 : 0));
  const conesJournal = conesWith(count, (j) => (j % STRIDE === OFFSET ? 0 : 0.5));
  const conesBalayage = conesJournal.slice();
  // Le journal ne nomme que les pages dont la résidence a bougé, dans l'ordre croissant.
  const pages = Int32Array.from({ length: count }, (_, j) => j).filter((j) => j % 7 === 0);
  const changes = { pages: Int32Array.from(pages), count: pages.length, sorted: true };
  const touched = new Int32Array(count);
  const retenues = updateResidencyFlags(
    next,
    new Float32Array(count),
    conesJournal,
    STRIDE,
    OFFSET,
    changes,
    touched,
  );
  assert.equal(retenues, pages.length, 'une page retenue par entrée du journal');
  assert.deepEqual([...touched.slice(0, retenues)], [...pages]);
  balayage(next, new Float32Array(count), conesBalayage);
  assert.deepEqual([...conesJournal], [...conesBalayage]);
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
