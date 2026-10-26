import type { PackedDag } from './types.ts'
import { primitiveFrameWords } from './worlds/worlds.ts'
import { createCameraFrames } from './cameraFrames.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { cameraCutBuffers, makeDagBuffer } from './bufferTable.ts'
import { createDagList } from './lists/listCap.ts'
import { DAG_ARGS_INITIAL } from './shader/armWgsl.ts'
import { createTreeTable } from './tree/treeTable.ts'
import { createCutTables } from './cut/cutTables.ts'
import type { TextureMaker } from '../../gpu/core/recordTexture.ts'
import type { CutListCaps } from './lists/cutListCaps.ts'

/** What makes the cut's buffers and its record tables' textures: its admission (`resources.ts`). */
type CutMakers = {
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer
  ownTexture: TextureMaker
}

/** The camera's block and the dispatch arguments (`shader/armWgsl.ts`). */
function uniformBuffers(own: CutMakers['own'], device: GPUDevice) {
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
  return { uniforms, dispatchArgs }
}

/** The buffers of the rows the cut keeps: the list counts the arming kernel reads through its own
 *  group, the clusters the cut draws — written by its cull — and the records of the clusters it
 *  reads (`visible/layout.ts`, `info/clusterInfoLayout.ts`): the host writes the last as pages
 *  land. */
function rowBuffers(own: CutMakers['own'], rows: ReturnType<typeof cameraCutBuffers>['rows']) {
  return {
    work: makeDagBuffer(own, rows.work),
    visible: makeDagBuffer(own, rows.visible),
    info: makeDagBuffer(own, rows.info),
    edges: makeDagBuffer(own, rows.edges),
  }
}

/** The group the kernels bind. */
function bindingGroup(t: {
  uniforms: GPUBuffer
  list: ReturnType<typeof createDagList>
  work: GPUBuffer
  visible: GPUBuffer
  info: GPUBuffer
  edges: GPUBuffer
  cutTables: ReturnType<typeof createCutTables>
  treeTable: ReturnType<typeof createTreeTable>
}) {
  return {
    cutView: t.uniforms,
    out: t.list.output,
    work: t.work,
    visible: t.visible,
    info: t.info,
    edges: t.edges,
    clusters: t.cutTables.clusters.view,
    nodes: t.cutTables.nodes.view,
    cold: t.cutTables.cold.view,
    flags: t.cutTables.flags.view,
    tree: t.treeTable.view,
  }
}

/** Every buffer and record table of the cut, written as the packing laid them, and the group its
 *  kernels bind: four storage buffers — the readout, `work`, the visible clusters and the clusters'
 *  records — whatever the world, every other table a record table (`cut/cutTables.ts`). */
export function dagTables(
  device: GPUDevice,
  packed: PackedDag,
  { own, ownTexture }: CutMakers,
  listCap: number,
  heldSlots: number,
  caps: CutListCaps,
) {
  const { rows, blockCount, workLayout, shape, visibleCap } = cameraCutBuffers(packed, caps)
  // The camera's block (`shader/viewsWgsl.ts`, `DAG_UNIFORM_BYTES`).
  const uniformData = new Float32Array(DAG_UNIFORM_BYTES / 4)
  const frameData = primitiveFrameWords(packed)
  const { uniforms, dispatchArgs } = uniformBuffers(own, device)
  const list = createDagList(own, listCap, heldSlots)
  const { work, visible, info, edges } = rowBuffers(own, rows)
  const worldCount = Math.max(1, packed.worldCount)
  const { worlds, worldSources } = packed
  const frames = createCameraFrames(device, frameData, worldCount, worlds, worldSources, ownTexture)
  // The placement tree's record table (`tree/treeTable.ts`): the culling, the refit and the rays read it.
  const treeTable = createTreeTable(device, packed.placementTree, ownTexture)
  const cutTables = createCutTables(device, packed, shape, ownTexture)
  const group = bindingGroup({ uniforms, list, work, visible, info, edges, cutTables, treeTable })
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
    frameData,
    group,
    uniforms,
    dispatchArgs,
    work,
    visible,
    info,
    edges,
    /** The records `visible` holds room for, followed as the cut's demand moves it
     *  (`visible/visibleGrowth.ts`). */
    visibleCap,
    frames,
    treeTable,
    /** The clusters, the nodes, the cold words and the flags (`cut/cutTables.ts`). */
    cutTables,
    /** The cold words as the host writes them, a word at a time (`writeRanges`). */
    cold: cutTables.cold.target('Word'),
    /** What `flags` holds now: its lists at their caps, laid out again when they change
     *  (`queueGrowth.ts`). */
    flagShape: shape,
    /** The caps its lists hold now (`lists/cutListCaps.ts`), what their overflows are said against. */
    listCaps: caps,
  }
}
