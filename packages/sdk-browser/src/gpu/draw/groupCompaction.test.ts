import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE_SLOTS, slotCount } from './contract.ts';
import { prefixSerial } from '../../../../../bench/oracles/browser/gpuDrawPrefixOracle.ts';

// The counting and scattering kernels moved from one thread per (group, slot) — each walking the
// group's 64 items in the storage buffer — to one workgroup per group, each lane reading its own
// item once and working from workgroup memory. Below, both pairs of kernels transcribed line by
// line must write the same `groupCounts` and the same `instances`, hence the same draws in the
// same order, on random frames: partial groups, selection masks, empty slots, overflow.

const GROUP = 64;
const NO_SLOT = 0xffffffff;

type Frame = {
  bins: number[];
  layers: number[];
  pages: number[];
  rest: number[];
  mask?: number[];
  count: number;
  slotCap: number;
  layerSlots: number;
  slotUsed: Uint32Array;
};

const slotOf = (f: Frame, i: number) =>
  f.rest[i] * 3 + f.bins[i] + BASE_SLOTS * Math.min(f.layers[i], Math.max(1, f.layerSlots) - 1);
const selected = (f: Frame, i: number) => !f.mask || f.mask[i] !== 0;
const matches = (f: Frame, i: number, slot: number) => slotOf(f, i) === slot && selected(f, i);
/** Transcribes WGSL `slotAt`. */
const slotAt = (f: Frame, i: number, end: number) =>
  i >= end || !selected(f, i) ? NO_SLOT : slotOf(f, i);

function countBefore(f: Frame, groups: number, slots: number) {
  const counts = new Uint32Array(groups * slots);
  for (let entry = 0; entry < groups * slots; entry++) {
    const group = Math.floor(entry / slots),
      slot = entry % slots;
    if (f.slotUsed[slot] === 0) continue;
    const end = Math.min(group * GROUP + GROUP, Math.min(f.count, f.slotCap));
    for (let i = group * GROUP; i < end; i++) if (matches(f, i, slot)) counts[entry]++;
  }
  return counts;
}

function countAfter(f: Frame, groups: number, slots: number) {
  const counts = new Uint32Array(groups * slots);
  for (let group = 0; group < groups; group++) {
    const tally = new Uint32Array(slots);
    for (let lane = 0; lane < GROUP; lane++) {
      const s = slotAt(f, group * GROUP + lane, Math.min(f.count, f.slotCap));
      if (s !== NO_SLOT) tally[s]++;
    }
    for (let slot = 0; slot < slots; slot++)
      counts[group * slots + slot] = f.slotUsed[slot] === 0 ? 0 : tally[slot];
  }
  return counts;
}

function scatterBefore(f: Frame, groups: number, slots: number, offsets: Uint32Array) {
  const instances = new Uint32Array(f.count + 1).fill(NO_SLOT);
  for (let i = 0; i < groups * GROUP; i++) {
    if (i >= f.count || f.count > f.slotCap || !selected(f, i)) continue;
    const slot = slotOf(f, i),
      group = Math.floor(i / GROUP);
    let rank = 0;
    for (let j = group * GROUP; j < i; j++) if (matches(f, j, slot)) rank++;
    instances[offsets[group * slots + slot] + rank] = f.pages[i];
  }
  return instances;
}

function scatterAfter(f: Frame, groups: number, slots: number, offsets: Uint32Array) {
  const instances = new Uint32Array(f.count + 1).fill(NO_SLOT);
  if (f.count > f.slotCap) return instances;
  for (let group = 0; group < groups; group++) {
    const laneSlots = Array.from({ length: GROUP }, (_, lane) =>
      slotAt(f, group * GROUP + lane, f.count),
    );
    for (let lane = 0; lane < GROUP; lane++) {
      const s = laneSlots[lane];
      if (s === NO_SLOT) continue;
      let rank = 0;
      for (let j = 0; j < lane; j++) if (laneSlots[j] === s) rank++;
      instances[offsets[group * slots + s] + rank] = f.pages[group * GROUP + lane];
    }
  }
  return instances;
}

function frame(rand: () => number): Frame {
  const n = Math.floor(rand() * 300),
    layerSlots = 1 + Math.floor(rand() * 4);
  const pick = (k: number) => Array.from({ length: n }, () => Math.floor(rand() * k));
  const f: Frame = {
    bins: pick(3),
    layers: pick(layerSlots + 1),
    pages: pick(1 << 20),
    rest: pick(2),
    mask: rand() < 0.5 ? pick(2) : undefined,
    count: n,
    // A cap below the count is the overflow the kernels must turn into empty draws.
    slotCap: rand() < 0.15 ? Math.floor(rand() * n) : n + Math.floor(rand() * 64),
    layerSlots,
    slotUsed: new Uint32Array(slotCount(layerSlots)),
  };
  // `slotUsed` counts every row before the selection mask, as the partition does, plus a few
  // slots marked used with nothing in them, and a few cleared: those must still count zero.
  for (let i = 0; i < n; i++) f.slotUsed[slotOf(f, i)]++;
  for (let s = 0; s < f.slotUsed.length; s++) {
    const r = rand();
    f.slotUsed[s] = r < 0.1 ? f.slotUsed[s] + 1 : r < 0.15 ? 0 : f.slotUsed[s];
  }
  return f;
}

test('grouped counting and scattering write the counts and draws of the per-slot walk', () => {
  let seed = 7;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 600; trial++) {
    const f = frame(rand);
    const slots = slotCount(f.layerSlots);
    const groups = Math.max(1, Math.ceil(Math.min(f.count, f.slotCap) / GROUP));
    const counts = countBefore(f, groups, slots);
    assert.deepEqual(countAfter(f, groups, slots), counts, `trial ${trial}: groupCounts`);
    const overflow = f.count > f.slotCap;
    const { offsets } = prefixSerial(overflow, f.slotUsed, counts, groups, slots);
    assert.deepEqual(
      scatterAfter(f, groups, slots, offsets),
      scatterBefore(f, groups, slots, offsets),
      `trial ${trial}: instances`,
    );
  }
});
