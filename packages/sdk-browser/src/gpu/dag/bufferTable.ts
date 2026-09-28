import { storageBufferCap } from '../../residency/pools.ts';
import { SELECTION_WORKGROUP } from '../core/selection.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { dagFlagsWords } from './shader/lastUseWgsl.ts';
import { stagedOutputBytes } from './layout.ts';
import { FRAME_VEC4, type PackedDag } from './types.ts';

/** One storage buffer of a cut: its label, its bytes, and whether a copy reads it. */
export type DagBufferRow = { label: string; size: number; copySource?: boolean };

/** `row` made a buffer by `make` — a device's `createBuffer`, or a cut's own (`resources.ts`). */
export const makeDagBuffer = (make: (d: GPUBufferDescriptor) => GPUBuffer, row: DagBufferRow) =>
  make({
    label: row.label,
    size: row.size,
    usage:
      GPUBufferUsage.STORAGE |
      GPUBufferUsage.COPY_DST |
      (row.copySource ? GPUBufferUsage.COPY_SRC : 0),
  });

/**
 * THE BUFFERS OF A CAMERA CUT, as `createDagResources` makes them: one table read by the resources
 * and by the device check (`deviceRefusal.ts`), so the check can never judge a size the cut does
 * not ask for. `blockCount` is the kernel's `blockCount()`, word for word, and `travail` the layout
 * of `work` (`dagWorkLayout`).
 */
export function cameraCutBuffers(
  packed: Pick<PackedDag, 'pageCount' | 'nodeCount' | 'clusters' | 'nodes' | 'pageCones'>,
) {
  const blockCount = Math.ceil(packed.pageCount / SELECTION_WORKGROUP),
    travail = dagWorkLayout(blockCount);
  const flags = dagFlagsWords(packed.nodeCount, packed.pageCount) * 4;
  return {
    blockCount,
    travail,
    rows: {
      clusters: {
        label: 'Trillion3D DAG clusters',
        size: Math.max(64, packed.clusters.byteLength),
      },
      nodes: { label: 'Trillion3D DAG nodes', size: Math.max(64, packed.nodes.byteLength) },
      pageCones: {
        label: 'Trillion3D DAG page cones',
        size: Math.max(48, packed.pageCones.byteLength),
      },
      flags: { label: 'Trillion3D DAG flags', size: Math.max(16, flags), copySource: true },
      work: {
        label: 'Trillion3D DAG work',
        size: Math.max(8, travail.words * 4),
        copySource: true,
      },
    } satisfies Record<string, DagBufferRow>,
  };
}

/** The readout of a cut whose list holds `listCap` ranks, as `createDagList` makes it (`listCap.ts`). */
export const readoutRow = (listCap: number): DagBufferRow => ({
  label: 'Trillion3D DAG readback',
  size: stagedOutputBytes(listCap),
  copySource: true,
});

/** What a scene's DAG makes a light cut carry per view. */
export type LightCutShape = {
  worldCount: number;
  nodeCount: number;
  pageCount: number;
  blockCount: number;
  levelSizes: ArrayLike<number>;
  /** The camera's `frames` ranges: the light cut's per-view rows split in them (`frameRanges.ts`). */
  frames: { per: number };
};

/** Each descent queue: every node, or one root per slot when the slots outnumber the nodes. */
export const lightQueueCap = (shape: LightCutShape, views: number) =>
  Math.max(shape.nodeCount, shape.worldCount * views);

/**
 * THE BUFFERS OF A LIGHT CUT of `views` views, as `createDagLightCut` makes them (`lightCut.ts`),
 * and as `lightCutCapacity` judges them: its flags, its work, and `frames(count)`, one range's
 * per-view rows — the largest, `shape.frames.per`, is the one the device must hold.
 */
export function lightCutBuffers(shape: LightCutShape, views: number) {
  const queueCap = lightQueueCap(shape, views),
    travail = dagWorkLayout(shape.blockCount, views);
  return {
    queueCap,
    travail,
    rows: {
      flags: {
        label: 'Trillion3D light cut flags',
        size: dagFlagsWords(queueCap, shape.pageCount, false) * 4,
      },
      work: { label: 'Trillion3D light cut work', size: travail.words * 4, copySource: true },
    } satisfies Record<string, DagBufferRow>,
    frames: (count: number): DagBufferRow => ({
      label: 'Trillion3D light cut frames',
      size: views * count * FRAME_VEC4 * 16,
    }),
  };
}

/** THE ONE FIT RULE of a cut's buffers: the first of `rows` past one storage binding of this
 *  device, by name, or `undefined` when the device holds them all. */
export function pastBinding(
  limits: Parameters<typeof storageBufferCap>[0],
  rows: Record<string, DagBufferRow>,
) {
  const limit = storageBufferCap(limits);
  for (const [buffer, { size }] of Object.entries(rows))
    if (size > limit) return { buffer, bytes: size, limit };
  return undefined;
}
