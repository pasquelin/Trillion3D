import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixParallel, prefixSerial } from './bench/oracles/gpuDrawPrefixOracle.ts';

// D3 : le prefixe parallele par slot (workgroup_size(64)) produit exactement les memes totals
// (indirect[slot*4+1]) et groupOffsets que le prefixe serie (workgroup_size(1)) en place dans
// gpuDrawShader.ts. Le noyau parallele reste un candidat : gpuDraw.test.ts epingle la taille du
// groupe de travail, et ce lot ne touche pas aux attentes des tests existants. Ce fichier garde la
// preuve d'equivalence, sur des entrees hostiles, pour le jour ou cette attente sera rouverte.

function assertSameResult(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
) {
  const serial = prefixSerial(overflow, slotUsed, groupCounts, groupCount, slots);
  const parallel = prefixParallel(overflow, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...parallel.totals], [...serial.totals], 'totals (indirect count) diffèrent');
  assert.deepEqual([...parallel.offsets], [...serial.offsets], 'groupOffsets diffèrent');
  return serial;
}

test('page sans triangle : tous les groupCounts a zero, slots tous marques utilises', () => {
  const slots = 6,
    groupCount = 4;
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots); // tout a zero
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...result.totals], new Array(slots).fill(0));
  assert.deepEqual([...result.offsets], new Array(groupCount * slots).fill(0));
});

test('un seul slot utilise parmi tous les autres vides', () => {
  const slots = 6,
    groupCount = 3;
  const slotUsed = new Uint32Array(slots); // tout a zero
  slotUsed[4] = 1;
  const groupCounts = new Uint32Array(groupCount * slots);
  for (let g = 0; g < groupCount; g++) groupCounts[g * slots + 4] = g + 1; // 1,2,3
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  assert.equal(result.totals[4], 6);
  for (let s = 0; s < slots; s++) if (s !== 4) assert.equal(result.totals[s], 0);
  assert.deepEqual([...result.offsets.filter((_, i) => i % slots === 4)], [0, 1, 3]);
});

test('tous les slots pleins, plus de groupes que de slots (256 lampes-echelle)', () => {
  const slots = 6,
    groupCount = 40; // 256 items / 64 par groupe, arrondi
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots);
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 17) as number;
  for (let i = 0; i < groupCounts.length; i++) groupCounts[i] = rand();
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  // Le total de chaque slot doit egaler la somme de sa colonne.
  for (let slot = 0; slot < slots; slot++) {
    let expected = 0;
    for (let g = 0; g < groupCount; g++) expected += groupCounts[g * slots + slot];
    assert.equal(result.totals[slot], expected);
  }
});

test('debordement (count > slotCap) : tous les totals a zero, aucun offset ecrit', () => {
  const slots = 6,
    groupCount = 5;
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots).fill(9);
  const result = assertSameResult(true, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...result.totals], new Array(slots).fill(0));
  assert.deepEqual([...result.offsets], new Array(groupCount * slots).fill(0));
});

test('couches coplanaires : 36 slots (6 couches), masques a zero au milieu', () => {
  const slots = 36,
    groupCount = 6;
  const slotUsed = new Uint32Array(slots).fill(1);
  for (let s = 12; s < 24; s++) slotUsed[s] = 0; // la couche du milieu est vide
  const groupCounts = new Uint32Array(groupCount * slots);
  for (let g = 0; g < groupCount; g++)
    for (let s = 0; s < slots; s++)
      groupCounts[g * slots + s] = slotUsed[s] ? ((g + s) % 5) + 1 : 0;
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  for (let s = 12; s < 24; s++) assert.equal(result.totals[s], 0);
});

test('cas explicite calcule a la main : deux slots utilises, deux groupes', () => {
  // slot0: groupes [3,2] -> total 5, offsets [0,3]
  // slot1: groupes [1,4] -> total 5, offsets [5,6]  (5 = total du slot0 qui le precede)
  const slots = 2,
    groupCount = 2;
  const slotUsed = new Uint32Array([1, 1]);
  const groupCounts = new Uint32Array([3, 1, 2, 4]); // [g0s0,g0s1,g1s0,g1s1]
  const serial = prefixSerial(false, slotUsed, groupCounts, groupCount, slots);
  const parallel = prefixParallel(false, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...serial.totals], [5, 5]);
  assert.deepEqual([...serial.offsets], [0, 5, 3, 6]);
  assert.deepEqual([...parallel.totals], [5, 5]);
  assert.deepEqual([...parallel.offsets], [0, 5, 3, 6]);
});
