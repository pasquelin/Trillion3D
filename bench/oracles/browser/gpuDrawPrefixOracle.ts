/**
 * Oracle: faithful, line-by-line ports of the `prefixGroups` kernel of packages/sdk-browser/src/gpu/draw/shader.ts.
 *
 * `prefixSerial` is the kernel from before the visibility batch (one thread, `@workgroup_size(1)`):
 * it walks slots in order and advances a single cursor. `prefixParallel` is the D3 kernel
 * (`@workgroup_size(64)`): each thread (lane) totals the slots that fall to it in steps of 64; a
 * workgroup barrier separates this phase from the offset computation, then each thread rebuilds
 * its cursor by resumming the totals of the slots that precede it. `prefixScan` is the kernel
 * shader.ts carries since #923: the slots in order, each one's groups spread over the 64 lanes in
 * contiguous runs whose totals are scanned in workgroup memory. All compute in u32 (`>>> 0`), as
 * WGSL does.
 *
 * This file depends on no real GPU run: `tests/kit/gpu/mockCompute.ts` does not replay
 * `prefixGroups` (it short-circuits the whole compaction with the CPU oracle `evaluateDrawCompact`),
 * so equivalence of the kernels is proved here by direct transcription and comparison.
 */

const WORKGROUP = 64;
const U32 = (n: number) => n >>> 0;

export type PrefixResult = {
  totals: Uint32Array; // what writeCmd(slot, ...) would write into indirect[slot*4+1]
  offsets: Uint32Array; // groupOffsets, length groupCount*slots; 0 for an empty slot (never read)
};

export function prefixSerial(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots);
  const offsets = new Uint32Array(groupCount * slots);
  if (overflow) return { totals, offsets };
  let slotStart = 0;
  for (let slot = 0; slot < slots; slot++) {
    if (slotUsed[slot] === 0) continue;
    let total = 0;
    for (let group = 0; group < groupCount; group++)
      total = U32(total + groupCounts[group * slots + slot]);
    let cursor = slotStart;
    for (let group = 0; group < groupCount; group++) {
      const entry = group * slots + slot;
      offsets[entry] = cursor;
      cursor = U32(cursor + groupCounts[entry]);
    }
    totals[slot] = total;
    slotStart = U32(slotStart + total);
  }
  return { totals, offsets };
}

export function prefixParallel(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots);
  const offsets = new Uint32Array(groupCount * slots);
  if (overflow) return { totals, offsets };
  const slotTotals = new Uint32Array(slots);
  // Phase 1: one thread per slot, in steps of 64; lane order does not matter, u32 addition
  // is associative and commutative — lanes are walked in reverse on purpose to prove it.
  for (let lane = WORKGROUP - 1; lane >= 0; lane--) {
    for (let slot = lane; slot < slots; slot += WORKGROUP) {
      if (slotUsed[slot] === 0) continue;
      let total = 0;
      for (let group = 0; group < groupCount; group++)
        total = U32(total + groupCounts[group * slots + slot]);
      slotTotals[slot] = total;
      totals[slot] = total;
    }
  }
  // workgroupBarrier(): all slotTotals are set before anyone resums them.
  for (let lane = WORKGROUP - 1; lane >= 0; lane--) {
    for (let slot = lane; slot < slots; slot += WORKGROUP) {
      if (slotUsed[slot] === 0) continue;
      let cursor = 0;
      for (let before = 0; before < slot; before++) cursor = U32(cursor + slotTotals[before]);
      for (let group = 0; group < groupCount; group++) {
        const entry = group * slots + slot;
        offsets[entry] = cursor;
        cursor = U32(cursor + groupCounts[entry]);
      }
    }
  }
  return { totals, offsets };
}

export function prefixScan(
  overflow: boolean,
  slotUsed: Uint32Array,
  groupCounts: Uint32Array,
  groupCount: number,
  slots: number,
): PrefixResult {
  const totals = new Uint32Array(slots);
  const offsets = new Uint32Array(groupCount * slots);
  if (overflow) return { totals, offsets };
  const run = Math.floor((groupCount + WORKGROUP - 1) / WORKGROUP);
  const first = (lane: number) => Math.min(lane * run, groupCount);
  const last = (lane: number) => Math.min(first(lane) + run, groupCount);
  let start = 0;
  for (let slot = 0; slot < slots; slot++) {
    const used = slotUsed[slot] !== 0;
    const sums = new Uint32Array(WORKGROUP);
    for (let lane = 0; lane < WORKGROUP; lane++)
      if (used)
        for (let group = first(lane); group < last(lane); group++)
          sums[lane] = U32(sums[lane] + groupCounts[group * slots + slot]);
    const lanes = Uint32Array.from(sums);
    // Hillis-Steele: every lane reads `step` below, a barrier, then every lane adds.
    for (let step = 1; step < WORKGROUP; step <<= 1) {
      const below = lanes.map((_, lane) => (lane >= step ? lanes[lane - step] : 0));
      for (let lane = 0; lane < WORKGROUP; lane++) lanes[lane] = U32(lanes[lane] + below[lane]);
    }
    const total = lanes[WORKGROUP - 1];
    if (used)
      for (let lane = WORKGROUP - 1; lane >= 0; lane--) {
        let cursor = U32(start + lanes[lane] - sums[lane]);
        for (let group = first(lane); group < last(lane); group++) {
          const entry = group * slots + slot;
          offsets[entry] = cursor;
          cursor = U32(cursor + groupCounts[entry]);
        }
      }
    totals[slot] = total;
    start = U32(start + total);
  }
  return { totals, offsets };
}
