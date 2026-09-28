import { storageBufferCap } from '../../residency/pools.ts';
import { SELECTION_WORKGROUP } from '../core/selection.ts';
import { cameraFrameRanges } from './frameRanges.ts';
import { stagedOutputBytes } from './layout.ts';
import { deviceListCap, type Limits } from './listCap.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { dagFlagsWords } from './shader/lastUseWgsl.ts';
import type { PackedDag } from './types.ts';

/**
 * THE BYTES OF A CAMERA CUT'S OWN BUFFERS, as `createDagResources` makes them: one table read by
 * both the resources and the device check, so the check can never judge a size the cut does not
 * ask for. `blockCount` is the kernel's `blockCount()`, word for word, and `travail` the layout of
 * `work` (`dagWorkLayout`).
 */
export function dagBufferBytes(packed: PackedDag) {
  const blockCount = Math.ceil(packed.pageCount / SELECTION_WORKGROUP),
    travail = dagWorkLayout(blockCount);
  return {
    blockCount,
    travail,
    bytes: {
      clusters: Math.max(64, packed.clusters.byteLength),
      nodes: Math.max(64, packed.nodes.byteLength),
      pageCones: Math.max(48, packed.pageCones.byteLength),
      flags: Math.max(16, dagFlagsWords(packed.nodeCount, packed.pageCount) * 4),
      work: Math.max(8, travail.words * 4),
    },
  };
}

/**
 * WHAT OF A CAMERA CUT THIS DEVICE CANNOT HOLD, by name, or `undefined` when it holds it all. A
 * buffer past one binding, or a flat dispatch past the workgroups of one dimension, would fail on
 * the device — a bind group refused, a dispatch skipped — and the GPU cut would be gone without a
 * word. Refused here, before any buffer, the host names it and the CPU cut draws. `frames` and
 * `worlds` are not checked: they split in ranges (`frameRanges.ts`), and a primitive's pass runs
 * once per range. The readout starts within one binding and grows no further (`listCap.ts`).
 */
export function dagDeviceRefusal(
  limits: Limits & { maxComputeWorkgroupsPerDimension?: number },
  packed: PackedDag,
) {
  const { pageCount, nodeCount, worldCount } = packed,
    limit = storageBufferCap(limits);
  for (const [buffer, size] of Object.entries(dagBufferBytes(packed).bytes))
    if (size > limit) return { buffer, bytes: size, limit };
  // The readout starts within one binding (`initialListCap`): refused only if not one rank fits.
  if (deviceListCap(limits) < 1) return { buffer: 'out', bytes: stagedOutputBytes(1), limit };
  // One thread per page, node or primitive of a range, flat along x: the widest pass (`encode.ts`).
  const perRange = cameraFrameRanges(limits, worldCount)[0]?.count ?? 0,
    workgroups = Math.ceil(Math.max(pageCount, nodeCount, perRange) / SELECTION_WORKGROUP),
    most = limits.maxComputeWorkgroupsPerDimension ?? Infinity;
  if (workgroups > most) return { dispatch: 'workgroups', workgroups, limit: most };
  return undefined;
}
