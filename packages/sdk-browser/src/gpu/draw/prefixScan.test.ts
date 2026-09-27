import test from 'node:test';
import assert from 'node:assert/strict';
import { drawShader } from './shader.ts';
import { slotCount } from './draw.ts';
import {
  prefixParallel,
  prefixScan,
  prefixSerial,
} from '../../../../../bench/oracles/browser/gpuDrawPrefixOracle.ts';

// The indirect-draw prefix walked every group of a slot on one thread (D3: one thread per slot).
// It now walks the slots in order with the sixty-four threads of the workgroup, each totalling a
// run of groups, the run totals scanned in workgroup memory (#923). This file pins both halves of
// the proof: the shipped kernel has the shape the oracle describes, and the oracle's kernels —
// serial, D3 and the scan — return the same result on random inputs: sparse empty slots, fewer
// groups than lanes, runs of several groups, overflow.

const prefixKernel = (shader: string) => {
  const start = shader.indexOf('fn prefixGroups');
  const end = shader.indexOf('fn scatterGroups');
  assert.ok(start >= 0 && end > start, 'the prefix kernel is present, before the scatter');
  return shader.slice(start, end);
};

test('the shipped prefix kernel scans each slot over the 64 threads in workgroup memory', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k);
    assert.match(shader, /var<workgroup> laneSums:array<u32,64>;/);
    assert.match(
      shader,
      /@compute @workgroup_size\(64\)\s*fn prefixGroups\(@builtin\(local_invocation_index\) lane:u32\)/,
    );
    const kernel = prefixKernel(shader);
    assert.match(kernel, new RegExp(`for\\(var slot=0u;slot<${slotCount(k)}u;slot\\+\\+\\)`));
    assert.match(
      kernel,
      /let run=\(uni\.groupCount\+63u\)\/64u;/,
      'each lane owns a run of groups',
    );
    assert.match(kernel, /for\(var step=1u;step<64u;step=step<<1u\)/, 'a scan over the lanes');
    assert.match(kernel, /var cursor=start\+laneSums\[lane\]-sum;/, 'an exclusive prefix per run');
    assert.doesNotMatch(kernel, /for\(var group=0u;group<uni\.groupCount;group\+\+\)/);
  }
});

test('on a thousand random inputs, the three kernels return the same totals and offsets', () => {
  let seed = 20260915;
  const rand = (bound: number) => ((seed = (seed * 1103515245 + 12345) >>> 0) % bound) as number;
  for (let trial = 0; trial < 1000; trial++) {
    const slots = slotCount(1 + rand(4));
    const groupCount = 1 + (trial % 3 === 0 ? rand(400) : rand(64));
    const slotUsed = new Uint32Array(slots);
    for (let s = 0; s < slots; s++) slotUsed[s] = rand(3) === 0 ? 0 : 1;
    const groupCounts = new Uint32Array(groupCount * slots);
    for (let g = 0; g < groupCount; g++)
      for (let s = 0; s < slots; s++) groupCounts[g * slots + s] = slotUsed[s] ? rand(97) : 0;
    const overflow = trial % 97 === 0;
    const serial = prefixSerial(overflow, slotUsed, groupCounts, groupCount, slots);
    for (const kernel of [prefixParallel, prefixScan]) {
      const result = kernel(overflow, slotUsed, groupCounts, groupCount, slots);
      assert.deepEqual([...result.totals], [...serial.totals], `totals, trial ${trial}`);
      assert.deepEqual([...result.offsets], [...serial.offsets], `offsets, trial ${trial}`);
    }
  }
});

test('the scan wraps at 2³² as the serial walk does', () => {
  const slots = 6,
    groupCount = 130;
  const slotUsed = new Uint32Array(slots).fill(1);
  const groupCounts = new Uint32Array(groupCount * slots).fill(0x7fffffff);
  const serial = prefixSerial(false, slotUsed, groupCounts, groupCount, slots);
  const scan = prefixScan(false, slotUsed, groupCounts, groupCount, slots);
  assert.deepEqual([...scan.totals], [...serial.totals]);
  assert.deepEqual([...scan.offsets], [...serial.offsets]);
});
