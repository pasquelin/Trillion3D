import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './gpuDrawShader.ts';
import { slotCount } from './gpuDraw.ts';
import { prefixParallel, prefixSerial } from '../../bench/oracles/browser/gpuDrawPrefixOracle.ts';

// D3: the indirect-draw prefix moved from a serial walk (one thread) to spreading slots over
// the sixty-four threads of a workgroup. This file pins both halves of the proof: the shipped
// kernel has the shape the oracle describes, and the oracle's two kernels return the same
// result on random inputs, including those the hand-written tests do not cover — sparse empty
// slots, very many groups, overflow.

const prefixKernel = (shader: string) => {
  const start = shader.indexOf('fn prefixGroups');
  const end = shader.indexOf('fn scatterGroups');
  assert.ok(start >= 0 && end > start, 'the prefix kernel is present, before the scatter');
  return shader.slice(start, end);
};

test('the shipped prefix kernel spreads slots over 64 threads, with a barrier between its two phases', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);
    const slots = slotCount(k);
    assert.match(
      shader,
      new RegExp(`var<workgroup> slotTotals:array<u32,${slots}>;`),
      'per-slot totals live in workgroup memory, sized to the open slots',
    );
    assert.match(
      shader,
      /@compute @workgroup_size\(64\)\s*fn prefixGroups\(@builtin\(local_invocation_id\) lid:vec3u\)/,
      'the prefix runs on sixty-four threads and reads its thread rank',
    );
    const kernel = prefixKernel(shader);
    assert.doesNotMatch(kernel, /slotStart/, 'no single cursor pushed from slot to slot');
    assert.equal(
      (kernel.match(/workgroupBarrier\(\);/g) ?? []).length,
      1,
      'one barrier, and only one, separates the totals from the offset computation',
    );
    // Each thread touches only the slots of its rank modulo 64, and re-sums the totals of those
    // that precede it: that is what makes the result identical to the serial walk.
    const stride = new RegExp(`for\\(var slot=lane;slot<${slots}u;slot\\+=64u\\)`, 'g');
    assert.equal(
      (kernel.match(stride) ?? []).length,
      4,
      "the kernel's four loops — clear, overflow, totals, offsets — walk slots in steps of 64",
    );
    assert.match(
      kernel,
      /for\(var before=0u;before<slot;before\+\+\)\{cursor=cursor\+slotTotals\[before\];\}/,
      "a slot's cursor is the sum of the totals of the slots that precede it",
    );
  }
});

test('on a thousand random inputs, both kernels return the same totals and the same offsets', () => {
  let seed = 20260915;
  const rand = (bound: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % bound) as number;
  for (let trial = 0; trial < 1000; trial++) {
    const slots = slotCount(1 + rand(4));
    const groupCount = 1 + rand(64);
    const slotUsed = new Uint32Array(slots);
    for (let s = 0; s < slots; s++) slotUsed[s] = rand(3) === 0 ? 0 : 1;
    const groupCounts = new Uint32Array(groupCount * slots);
    for (let g = 0; g < groupCount; g++)
      for (let s = 0; s < slots; s++) groupCounts[g * slots + s] = slotUsed[s] ? rand(97) : 0;
    const overflow = trial % 97 === 0;
    const serial = prefixSerial(overflow, slotUsed, groupCounts, groupCount, slots);
    const parallel = prefixParallel(overflow, slotUsed, groupCounts, groupCount, slots);
    assert.deepEqual([...parallel.totals], [...serial.totals], `totals, trial ${trial}`);
    assert.deepEqual([...parallel.offsets], [...serial.offsets], `offsets, trial ${trial}`);
  }
});
