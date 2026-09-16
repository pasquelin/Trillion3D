// A11 : la résidence demandée est posée en bits — un mot pour trente-deux grappes, qui est à lui
// seul son propre miroir — au lieu d'un flottant par page relu à travers les cônes ; `maxStretch`
// reçoit désormais une sous-vue au lieu d'un tableau recopié. Oracle : la colonne de résidence
// d'avant le lot A, dans `bench/oracles/residence.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../sdk-core/index.ts';
import { updateResidencyBits } from './gpuDagRuntime.ts';
import { residentWords } from './gpuDagLayout.ts';
import { referenceUpdateResidency, residencyColumn } from './bench/oracles/residence.mjs';

const STRIDE = 12,
  FLAG = 11;

/** Les cônes de l'oracle, dont seule la colonne de résidence est comparée. */
function conesWith(count: number, seed: (j: number) => number) {
  const cones = new Float32Array(count * STRIDE);
  for (let j = 0; j < count * STRIDE; j++) cones[j] = seed(j);
  return cones;
}
const colonne = (cones: Float32Array, count: number) =>
  Float32Array.from({ length: count }, (_, j) => (cones[j * STRIDE + FLAG] >= 0.5 ? 1 : 0));

/**
 * Le balayage complet, tel que l'oracle le fait : sans journal de rangs, toutes les pages sont
 * relues. `updateResidencyBits` rend le nombre de mots retenus et les nomme dans `touched` ; le
 * verdict que l'oracle rend est ce nombre ramené à un booléen.
 */
function balayage(next: Uint32Array, bits: Uint32Array) {
  const touched = new Int32Array(Math.max(1, residentWords(next.length)));
  const count = updateResidencyBits(next, bits, 0, undefined, touched);
  for (let i = 1; i < count; i++)
    assert.ok(touched[i] > touched[i - 1], 'les mots retenus sont croissants et sans répétition');
  return { changed: count > 0, count, touched: touched.slice(0, count) };
}

test('no page changing flags nothing, matching the reference exactly', () => {
  const next = new Uint32Array(0);
  const conesReference = conesWith(0, () => 0);
  assert.equal(balayage(next, new Uint32Array(1)).changed, false);
  assert.equal(referenceUpdateResidency(next, conesReference), false);
});

test('every page flips, some pages do not: same changed verdict, same residency column', () => {
  const count = 40;
  const next = new Uint32Array(count).map((_, j) => (j % 3 === 0 ? 0 : 1));
  const conesReference = conesWith(count, (j) => (j % STRIDE === FLAG ? 1 : 0.5));
  const bits = new Uint32Array(residentWords(count)).fill(0xffffffff);

  const optimisee = balayage(next, bits);
  assert.equal(optimisee.changed, referenceUpdateResidency(next, conesReference));
  assert.deepEqual(
    [...residencyColumn(bits, 0, count)],
    [...colonne(conesReference, count)],
    'la colonne en bits est celle que l’oracle écrit à travers les cônes',
  );

  // A second pass with the same `next` changes nothing more: the bits already reflect it.
  assert.equal(balayage(next, bits).changed, false);
});

test('a single page toggling on then off is reflected bit for bit, both directions', () => {
  const conesReference = conesWith(1, () => 0.5);
  const bits = new Uint32Array(1);
  assert.equal(balayage(new Uint32Array([1]), bits).changed, true);
  assert.equal(referenceUpdateResidency(new Uint32Array([1]), conesReference), true);
  assert.deepEqual([...residencyColumn(bits, 0, 1)], [...colonne(conesReference, 1)]);
  assert.equal(balayage(new Uint32Array([0]), bits).changed, true);
  assert.equal(referenceUpdateResidency(new Uint32Array([0]), conesReference), true);
  assert.deepEqual([...residencyColumn(bits, 0, 1)], [...colonne(conesReference, 1)]);
});

test('le journal des rangs trié pose les mêmes bits que le balayage complet', () => {
  const count = 40;
  const next = new Uint32Array(count).map((_, j) => (j % 7 === 0 ? 1 : 0));
  const journal = new Uint32Array(residentWords(count)),
    balaye = new Uint32Array(residentWords(count));
  // Le journal ne nomme que les pages dont la résidence a bougé, dans l'ordre croissant.
  const pages = Int32Array.from({ length: count }, (_, j) => j).filter((j) => j % 7 === 0);
  const changes = { pages: Int32Array.from(pages), count: pages.length, sorted: true };
  const touched = new Int32Array(residentWords(count));
  const retenus = updateResidencyBits(next, journal, 0, changes, touched);
  assert.equal(retenus, residentWords(count), 'un mot retenu par mot que le journal touche');
  balayage(next, balaye);
  assert.deepEqual([...journal], [...balaye]);
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
