import { storageBufferCap } from '../../residency/pools.ts';
import { SELECTION_WORKGROUP } from '../core/selection.ts';
import { stagedOutputBytes } from './layout.ts';
import { initialListCap } from './listCap.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { dagFlagsWords } from './shader/lastUseWgsl.ts';
import type { PackedDag } from './types.ts';

type Limits = Parameters<typeof storageBufferCap>[0] & {
  maxComputeWorkgroupsPerDimension?: number;
};

/**
 * WHAT OF A CAMERA CUT THIS DEVICE CANNOT HOLD, by name, or `undefined` when it holds it all. A
 * buffer past one binding, or a flat dispatch past the workgroups of one dimension, would fail on
 * the device — a bind group refused, a dispatch skipped — and the GPU cut would be gone without a
 * word. Refused here, before any buffer, the host names it and the CPU cut draws. `frames` is not
 * checked: it splits in ranges (`frameRanges.ts`). The readout starts within one binding and grows
 * no further (`listCap.ts`).
 */
export function dagDeviceRefusal(limits: Limits, packed: PackedDag) {
  const { pageCount, nodeCount, worldCount } = packed,
    limit = storageBufferCap(limits),
    blocks = Math.ceil(pageCount / SELECTION_WORKGROUP);
  const bytes = {
    clusters: packed.clusters.byteLength,
    nodes: packed.nodes.byteLength,
    worlds: packed.worlds.byteLength,
    pageCones: packed.pageCones.byteLength,
    flags: dagFlagsWords(nodeCount, pageCount) * 4,
    work: dagWorkLayout(blocks).words * 4,
    out: stagedOutputBytes(initialListCap(limits, pageCount)),
  };
  for (const [buffer, size] of Object.entries(bytes))
    if (size > limit) return { buffer, bytes: size, limit };
  // One thread per page, node or primitive, flat along x: the widest pass (`encode.ts`).
  const workgroups = Math.ceil(Math.max(pageCount, nodeCount, worldCount) / SELECTION_WORKGROUP),
    most = limits?.maxComputeWorkgroupsPerDimension ?? Infinity;
  if (workgroups > most) return { dispatch: 'workgroups', workgroups, limit: most };
  return undefined;
}
