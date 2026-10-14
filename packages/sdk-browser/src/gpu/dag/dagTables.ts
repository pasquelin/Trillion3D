import type { PackedDag } from './types.ts'
import { primitiveFrameWords } from './worlds.ts'
import { createCameraFrames } from './cameraFrames.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { VIEW_BLOCK_WORDS } from './viewLayout.ts'
import { AHEAD_VIEW } from './shader/aheadWgsl.ts'
import { cameraCutBuffers, makeDagBuffer } from './bufferTable.ts'
import { createDagList } from './listCap.ts'
import { DAG_ARGS_INITIAL } from './shader/armWgsl.ts'
import { createTreeTable } from './treeTable.ts'
import { createCutTables } from './cutTables.ts'
import type { TextureMaker } from './cutBuffers.ts'

/** What makes the cut's buffers and its record tables' textures: its admission (`resources.ts`). */
type CutMakers = {
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer
  ownTexture: TextureMaker
}

/** Every buffer and record table of the cut, written as the packing laid them, and the group its
 *  kernels bind: two storage buffers — the readout and `work` — whatever the world, every other
 *  table a record table (`cutTables.ts`). */
export function dagTables(
  device: GPUDevice,
  packed: PackedDag,
  { own, ownTexture }: CutMakers,
  listCap: number,
  heldSlots: number,
) {
  const { rows, blockCount, workLayout, shape } = cameraCutBuffers(packed)
  // The camera's block, then the view ahead's (`shader/aheadWgsl.ts`).
  const uniformData = new Float32Array((AHEAD_VIEW + 1) * VIEW_BLOCK_WORDS)
  const frameData = primitiveFrameWords(packed)
  const uniforms = own({
    label: 'Trillion3D DAG uniforms',
    size: DAG_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // One argument record per list without a bound, z one once and for all: x and y are armed
  // in the pass by the arming kernel, the only one that binds this buffer (`shader/armWgsl.ts`).
  const dispatchArgs = own({
    label: 'Trillion3D DAG dispatch arguments',
    size: DAG_ARGS_INITIAL.byteLength,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(dispatchArgs, 0, DAG_ARGS_INITIAL)
  const list = createDagList(own, listCap, 0, heldSlots)
  // The arming kernel reads the list counts here through its own group.
  const work = makeDagBuffer(own, rows.work)
  const worldCount = Math.max(1, packed.worldCount)
  const { worlds, worldSources } = packed
  const frames = createCameraFrames(device, frameData, worldCount, worlds, worldSources, ownTexture)
  // The placement tree's record table (`treeTable.ts`): the culling, the refit and the rays read it.
  const treeTable = createTreeTable(device, packed.placementTree, ownTexture)
  const cutTables = createCutTables(device, packed, shape, ownTexture)
  const group = {
    views: uniforms,
    out: list.output,
    work,
    clusters: cutTables.clusters.view,
    nodes: cutTables.nodes.view,
    cold: cutTables.cold.view,
    flags: cutTables.flags.view,
    tree: treeTable.view,
  }
  return {
    workLayout,
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    entryCount: packed.entryCount,
    worldCount,
    blockCount,
    ...list,
    levelSizes: packed.levelSizes,
    uniformData,
    /** `uniformData` read as words: a single word written alone (`swapEncode.ts`). */
    uniformWords: new Uint32Array(uniformData.buffer),
    frameData,
    group,
    uniforms,
    dispatchArgs,
    work,
    frames,
    treeTable,
    /** The clusters, the nodes, the cold words and the flags (`cutTables.ts`). */
    cutTables,
    /** The cold words as the host writes them, a word at a time (`writeRanges`). */
    cold: cutTables.cold.target('Word'),
    /** What `flags` holds now: its queues and lists grow on demand (`queueGrowth.ts`). */
    flagShape: shape,
  }
}
