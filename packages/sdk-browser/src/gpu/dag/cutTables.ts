import type { RecordLayout } from '../core/recordLayout.ts'
import { createRecordTexture } from '../core/recordTexture.ts'
import { CLUSTER_WORDS } from './layout.ts'
import { NODE_TABLE } from './nodeTable.ts'
import { flagShapeWords, type FlagShape } from './flagSections.ts'
import { DAG_NODE_FLOATS, type PackedDag } from './types.ts'

/**
 * THE CUT'S TABLES OF RECORDS, each one home whatever the world's size: record tables
 * (`../core/recordTexture.ts`) the cut's kernels read with `textureLoad` (`shader/bindings.ts`), never
 * a storage buffer of a stage's eight, never split. The clusters' hot records, `rgba32uint`, one
 * load a texel (`layout.ts`, `CLUSTER_WORDS`); the nodes (`nodeTable.ts`); the cold words —
 * the working table, the residency bits, the cold records, the keys, the groups, the pool's list
 * and the world's links (`layout.ts`) —, `r32uint`, the host writing them a word at a time; and
 * the flags — the descent's queues and lists —, `r32uint`, which the kernels read and write in
 * place (the WGSL feature `readonly_and_readwrite_storage_textures`).
 *
 * A row of clusters holds 2048, 6144 texels; a row of words 8192; a layer 1024 rows.
 */
export const CLUSTER_TABLE: RecordLayout = {
  label: 'Trillion3D DAG clusters',
  format: 'rgba32uint',
  fields: { Cluster: CLUSTER_WORDS / 4 },
  rowShift: 11,
  layerShift: 10,
}
/** The cold words, one a record. */
export const COLD_TABLE: RecordLayout = {
  label: 'Trillion3D DAG page cones',
  format: 'r32uint',
  fields: { Word: 1 },
  rowShift: 13,
  layerShift: 10,
}
/** The flags, one word a record. */
export const FLAG_TABLE: RecordLayout = { ...COLD_TABLE, label: 'Trillion3D DAG flags' }

/** What makes a table's texture, `bytes` large: a cut's admission (`resources.ts`). */
type Make = (descriptor: GPUTextureDescriptor, bytes: number) => GPUTexture

/** The cut's flags laid out for `shape` (`flagSections.ts`), made by `make`: read and written in
 *  place by the kernels, its kept section copied into the next when its queues grow
 *  (`queueGrowth.ts`). */
export const createFlagTable = (device: GPUDevice, shape: FlagShape, make?: Make) =>
  createRecordTexture(
    device,
    FLAG_TABLE,
    flagShapeWords(shape),
    GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
    make,
  )

/** The cut's tables of `packed` on `device`, each made by `make` and written whole as the packing
 *  laid it, and its flags laid out for `shape`. */
export function createCutTables(
  device: GPUDevice,
  packed: Pick<PackedDag, 'clusters' | 'nodes' | 'pageCones'>,
  shape: FlagShape,
  make?: Make,
) {
  const read = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  const table = (layout: RecordLayout, field: string, source: Float32Array, words: number) => {
    const records = source.length / words,
      made = createRecordTexture(device, layout, Math.max(1, records), read, make)
    made.write(field, 0, records, source.buffer as ArrayBuffer, source.byteOffset)
    return made
  }
  return {
    clusters: table(CLUSTER_TABLE, 'Cluster', packed.clusters, CLUSTER_WORDS),
    nodes: table(NODE_TABLE, 'Node', packed.nodes, DAG_NODE_FLOATS),
    cold: table(COLD_TABLE, 'Word', packed.pageCones, 1),
    flags: createFlagTable(device, shape, make),
  }
}
export type CutTables = ReturnType<typeof createCutTables>
