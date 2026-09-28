import { storageBufferCap } from '../../residency/pools.ts';
import { SELECTION_WORKGROUP } from '../core/selection.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { dagFlagsWords } from './shader/lastUseWgsl.ts';
import { stagedOutputBytes } from './layout.ts';
import { FRAME_VEC4, type PackedDag } from './types.ts';
import { ELEMENT_BYTES, dagSplit, flagPartWords, type DagSplit, type TableSplit } from './split.ts';

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

/** The rows of a table in parts of `per` elements of `bytes` each, over `total` bytes: the first
 *  under `row`'s label, the others numbered behind it. A whole table is `row` itself. */
function partRows(row: DagBufferRow, total: number, per: number, parts: number) {
  if (parts === 1) return [row];
  return Array.from({ length: parts }, (_, k) => ({
    ...row,
    label: k ? `${row.label} ${k}` : row.label,
    size: Math.min(per, total - k * per),
  }));
}

/** Each part of `parts` a row of the one table, named `name`, `name1`… as the kernel binds them. */
const namedParts = (name: string, parts: DagBufferRow[]) =>
  Object.fromEntries(parts.map((row, k) => [k ? `${name}${k}` : name, row]));

/**
 * THE BUFFERS OF A CAMERA CUT, as `createDagResources` makes them: one table read by the resources
 * and by the device check (`deviceRefusal.ts`), so the check can never judge a size the cut does
 * not ask for. `blockCount` is the kernel's `blockCount()`, word for word, and `workLayout` the layout
 * of `work` (`dagWorkLayout`). On `limits`, a table past one binding is in parts (`split.ts`):
 * `parts` the rows of each, `rows` all of them, each part one row.
 */
export function cameraCutBuffers(
  packed: Pick<
    PackedDag,
    'pageCount' | 'nodeCount' | 'worldCount' | 'clusters' | 'nodes' | 'pageCones'
  >,
  limits?: Parameters<typeof storageBufferCap>[0],
) {
  const blockCount = Math.ceil(packed.pageCount / SELECTION_WORKGROUP),
    workLayout = dagWorkLayout(blockCount);
  const flagWords = dagFlagsWords(packed.nodeCount, packed.pageCount);
  const split = dagSplit(limits, packed, {
    clusters: packed.clusters.byteLength,
    nodes: packed.nodes.byteLength,
    cold: packed.pageCones.byteLength,
  });
  const table = (label: string, bytes: number, least: number, part: TableSplit, element: number) =>
    partRows({ label, size: Math.max(least, bytes) }, bytes, part.per * element, part.parts);
  const parts = {
    clusters: table(
      'Trillion3D DAG clusters',
      packed.clusters.byteLength,
      64,
      split.clusters,
      ELEMENT_BYTES.clusters,
    ),
    nodes: table(
      'Trillion3D DAG nodes',
      packed.nodes.byteLength,
      64,
      split.nodes,
      ELEMENT_BYTES.nodes,
    ),
    pageCones: table(
      'Trillion3D DAG page cones',
      packed.pageCones.byteLength,
      48,
      split.cold,
      ELEMENT_BYTES.cold,
    ),
    flags: flagRows(
      'Trillion3D DAG flags',
      split.flagCuts,
      packed.nodeCount,
      packed.pageCount,
      flagWords,
      true,
    ),
  };
  return {
    blockCount,
    workLayout,
    split,
    parts,
    rows: {
      ...namedParts('clusters', parts.clusters),
      ...namedParts('nodes', parts.nodes),
      ...namedParts('pageCones', parts.pageCones),
      ...namedParts('flags', parts.flags),
      work: {
        label: 'Trillion3D DAG work',
        size: Math.max(8, workLayout.words * 4),
        copySource: true,
      },
    } satisfies Record<string, DagBufferRow>,
  };
}

/** The rows of a `flags` of `words` cut at `cuts` (`split.ts`); a camera's are copy sources. */
function flagRows(
  label: string,
  cuts: readonly number[],
  queueCap: number,
  pageCount: number,
  words: number,
  copySource?: true,
): DagBufferRow[] {
  const sizes = flagPartWords(cuts, queueCap, pageCount, words);
  return sizes.map((part, k) => ({
    label: k ? `${label} ${k}` : label,
    size: Math.max(16, part * 4),
    ...(copySource && { copySource }),
  }));
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
  /** The flag sections the camera cut's `flags` parts start at: the light cut's cut at the same
   *  ones, the kernel's text being one (`split.ts`). None: whole. */
  split?: Pick<DagSplit, 'flagCuts'>;
};

/** Each descent queue: every node, or one root per slot when the slots outnumber the nodes. */
const lightQueueCap = (shape: LightCutShape, views: number) =>
  Math.max(shape.nodeCount, shape.worldCount * views);

/**
 * THE BUFFERS OF A LIGHT CUT of `views` views, as `createDagLightCut` makes them (`lightCut.ts`),
 * and as `lightCutCapacity` judges them: its flags, in the camera's parts, its work, and
 * `frames(count)`, one range's per-view rows — the largest, `shape.frames.per`, is the one the
 * device must hold.
 */
export function lightCutBuffers(shape: LightCutShape, views: number) {
  const queueCap = lightQueueCap(shape, views),
    workLayout = dagWorkLayout(shape.blockCount, views);
  const flags = flagRows(
    'Trillion3D light cut flags',
    shape.split?.flagCuts ?? [],
    queueCap,
    shape.pageCount,
    dagFlagsWords(queueCap, shape.pageCount, false),
  );
  return {
    queueCap,
    workLayout,
    flags,
    rows: {
      ...namedParts('flags', flags),
      work: { label: 'Trillion3D light cut work', size: workLayout.words * 4, copySource: true },
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
