import type { PackedDag } from './types.ts'
import { primitiveFrameWords } from './worlds.ts'
import { createCameraFrames, type CameraFrames } from './frameRanges.ts'
import { createDagPipeline } from './pipeline.ts'
import { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts'
import { AHEAD_VIEW } from './shader/aheadWgsl.ts'
import { makeDagBuffer } from './bufferTable.ts'
import { dagGroup, dagTables, uploadDagTables, type Own } from './resourceTables.ts'
import { createDagList, initialListCap } from './listCap.ts'
import { createDagArm } from './arm.ts'
import { DAG_ARGS_INITIAL } from './shader/armWgsl.ts'
import { validated } from '../core/errorScope.ts'
import { createMaskSwap } from './swap.ts'

export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  repeat: 'all' | 'head' | null = null,
  // Sized by the pages its roots hold, not the room a growth keeps: a list grows on demand.
  listCap = initialListCap(device.limits, packed.live?.pages ?? packed.pageCount),
) {
  const buffers: GPUBuffer[] = []
  /** A buffer of this cut's: the runtime's dispose destroys them all. */
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = device.createBuffer(descriptor)
    buffers.push(buffer)
    return buffer
  }
  try {
    const { tables, ...made } = dagBuffers(device, packed, own, listCap)
    const { group, frames, split, work, dispatchArgs } = made
    // One validation scope after the other: the device's scopes are one stack, and two built
    // together would each pop the other's.
    const pipeline = await createDagPipeline(device, group, frames, split)
    const arm =
      pipeline &&
      (await validated(device, () => createDagArm(device, work, dispatchArgs, tables.workLayout)))
    if (!pipeline || !arm) {
      for (const buffer of buffers) buffer.destroy()
      return undefined
    }
    const resources = {
      device,
      packed,
      repeat,
      ...made,
      buffers,
      own,
      ...uploadDagTables(device, packed, tables),
      ...pipeline,
      ...arm,
      /** Whose cut the mask, the journal and `out` hold (`swap.ts`). */
      swap: createMaskSwap(),
    }
    return { ...resources, rankGroups: rankGroups(resources) }
  } catch {
    for (const buffer of buffers)
      try {
        buffer.destroy()
      } catch {
        /* Partial setup must not leak. */
      }
    return undefined
  }
}

/** Every buffer of the cut, and the group its kernels bind. */
function dagBuffers(device: GPUDevice, packed: PackedDag, own: Own, listCap: number) {
  const tables = dagTables(device, packed, own)
  const { rows, blockCount, split } = tables
  // The camera's block, then the view ahead's (`shader/aheadWgsl.ts`).
  const uniformData = new Float32Array((AHEAD_VIEW + 1) * DAG_VIEW_WORDS)
  const frameData = primitiveFrameWords(packed)
  const uniforms = own({
    size: DAG_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // One argument record per list without a bound, z one once and for all: x and y are armed
  // in the pass by the arming kernel, the only one that binds this buffer (`shader/armWgsl.ts`).
  const dispatchArgs = own({
    size: DAG_ARGS_INITIAL.byteLength,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(dispatchArgs, 0, DAG_ARGS_INITIAL)
  const list = createDagList(own, listCap)
  // No extra storage buffer in the selection's group, a stage's ceiling is already reached: the
  // arming kernel reads the list counts here through its own group.
  const work = makeDagBuffer(own, rows.work)
  // Each kept list's ranks: its kernels bind them as `work`.
  const ranks = [rows.ranks0, rows.ranks1].map((row) => makeDagBuffer(own, row))
  const worldCount = Math.max(1, packed.worldCount)
  const { worlds, worldSources } = packed
  const frames = createCameraFrames(device, frameData, worldCount, own, worlds, worldSources)
  const group = dagGroup(tables, uniforms, list.output, work)
  const { clusters, nodes, flags, cold: pageCones } = group
  return {
    tables,
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    worldCount,
    blockCount,
    ...list,
    levelSizes: packed.levelSizes,
    uniformData,
    /** `uniformData` read as words: a single word written alone (`swapEncode.ts`). */
    uniformWords: new Uint32Array(uniformData.buffer),
    frameData,
    group,
    clusters,
    nodes,
    uniforms,
    flags,
    dispatchArgs,
    work,
    frames,
    pageCones,
    /** How the tables split on this device, and each as its parts (`split.ts`). */
    split,
    flagParts: tables.flags,
    ranks,
  }
}

/** The cut's group of each kept list, its ranks where the cut binds `work`: what its difference
 *  kernels bind (`shader/differenceWgsl.ts`), made again with the ranges when `out` is
 *  (`listCap.ts`). */
export function rankGroups(resources: {
  layout: GPUBindGroupLayout
  frames: Pick<CameraFrames, 'bindGroup'>
  group: Parameters<CameraFrames['bindGroup']>[1]
  ranks: GPUBuffer[]
}) {
  const { layout, frames, group } = resources
  // The first range's group alone: the difference reads no primitive's words.
  return resources.ranks.map((work) => frames.bindGroup(layout, { ...group, work }, 0))
}
