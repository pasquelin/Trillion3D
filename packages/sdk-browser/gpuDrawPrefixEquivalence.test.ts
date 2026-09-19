import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixParallel, prefixSerial } from './bench/oracles/gpuDrawPrefixOracle.ts';

// D3: the per-slot parallel prefix (workgroup_size(64)), in place in gpuDrawShader.ts since the
// visibility batch, produces exactly the same totals (indirect[slot*4+1]) and groupOffsets as the
// serial prefix (workgroup_size(1)) it replaces. This file keeps the equivalence proof on hostile
// inputs: that is what authorizes the parallel kernel to decide the indirect draw.

function assertSameResult(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
) {
  const serial = prefixSerial(overflow, slotUsed, groupCounts, groupCount, slots);
  const parallel = prefixParallel(overflow, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...parallel.totals], [...serial.totals], 'totals (indirect count) differ');
  assert.deepEqual([...parallel.offsets], [...serial.offsets], 'groupOffsets differ');
  return serial;
}

test('page with no triangle: every groupCount is zero, every slot marked used', () => {
  const slots = 6,
    groupCount = 4;
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots); // all zeros
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...result.totals], new Array(slots).fill(0));
  assert.deepEqual([...result.offsets], new Array(groupCount * slots).fill(0));
});

test('a single used slot among otherwise empty ones', () => {
  const slots = 6,
    groupCount = 3;
  const slotUsed = new Uint32Array(slots); // all zeros
  slotUsed[4] = 1;
  const groupCounts = new Uint32Array(groupCount * slots);
  for (let g = 0; g < groupCount; g++) groupCounts[g * slots + 4] = g + 1; // 1,2,3
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  assert.equal(result.totals[4], 6);
  for (let s = 0; s < slots; s++) if (s !== 4) assert.equal(result.totals[s], 0);
  assert.deepEqual([...result.offsets.filter((_, i) => i % slots === 4)], [0, 1, 3]);
});

test('every slot full, more groups than slots (256 lamp-scale)', () => {
  const slots = 6,
    groupCount = 40; // 256 items / 64 per group, rounded up
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots);
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 17) as number;
  for (let i = 0; i < groupCounts.length; i++) groupCounts[i] = rand();
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  // Each slot's total must equal the sum of its column.
  for (let slot = 0; slot < slots; slot++) {
    let expected = 0;
    for (let g = 0; g < groupCount; g++) expected += groupCounts[g * slots + slot];
    assert.equal(result.totals[slot], expected);
  }
});

test('overflow (count > slotCap): every total is zero, no offset written', () => {
  const slots = 6,
    groupCount = 5;
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots).fill(9);
  const result = assertSameResult(true, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...result.totals], new Array(slots).fill(0));
  assert.deepEqual([...result.offsets], new Array(groupCount * slots).fill(0));
});

test('coplanar layers: 36 slots (6 layers), masks zeroed in the middle', () => {
  const slots = 36,
    groupCount = 6;
  const slotUsed = new Uint32Array(slots).fill(1);
  for (let s = 12; s < 24; s++) slotUsed[s] = 0; // the middle layer is empty
  const groupCounts = new Uint32Array(groupCount * slots);
  for (let g = 0; g < groupCount; g++)
    for (let s = 0; s < slots; s++)
      groupCounts[g * slots + s] = slotUsed[s] ? ((g + s) % 5) + 1 : 0;
  const result = assertSameResult(false, slotUsed, groupCounts, groupCount, slots);
  for (let s = 12; s < 24; s++) assert.equal(result.totals[s], 0);
});

test('hand-computed explicit case: two used slots, two groups', () => {
  // slot0: groups [3,2] -> total 5, offsets [0,3]
  // slot1: groups [1,4] -> total 5, offsets [5,6]  (5 = total of slot0 that precedes it)
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
