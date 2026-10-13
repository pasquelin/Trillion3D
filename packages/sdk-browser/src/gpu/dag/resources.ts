import type { PackedDag } from './types.ts'
import { primitiveFrameWords } from './worlds.ts'
import { createCameraFrames } from './frameRanges.ts'
import { createDagPipeline } from './pipeline.ts'
import { DAG_UNIFORM_BYTES } from './shader/viewsWgsl.ts'
import { VIEW_BLOCK_WORDS } from './viewLayout.ts'
import { AHEAD_VIEW } from './shader/aheadWgsl.ts'
import { makeDagBuffer } from './bufferTable.ts'
import { dagGroup, dagTables, uploadDagTables, type Own } from './resourceTables.ts'
import { createDagList, cutHeldSlots, initialListCap, rankGroups } from './listCap.ts'
import { createDagArm } from './arm.ts'
import { DAG_ARGS_INITIAL } from './shader/armWgsl.ts'
import { validatedOrWhy } from '../core/errorScope.ts'
import { createMaskSwap } from './swap.ts'
import { VIEW_ROWS } from '../../webgpu/row/tableRows.ts'
import { CUT_TABLE_BYTES } from '../../residency/cutTableBytes.ts'
import type { CutSteps } from './cutSteps.ts'
import { admitted, madeAsked, type CutAdmission } from './cutBuffers.ts'
import { createMainReadbacks } from './mainReadbacks.ts'
import { createTreeTable } from './treeTable.ts'
import { recordsIdentity } from './recordsFollow.ts'

/** The DAG's GPU resources once made (`createDagResources`). */
export type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** The cut's buffers, pipelines and groups, or `undefined` when the device refuses them: why is
 *  told to `refused` by the device's own words, never swallowed. */
export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  repeat: 'all' | 'head' | null = null,
  // Sized by the pages its roots hold, not the room a growth keeps: a list grows on demand.
  listCap?: number,
  refused: (reason: string) => void = () => {},
  // The open counts placements hold of their own follow what the row cache holds resident
  // (`heldOpen.ts`): a cut made beside none sizes them for the rows a view starts with, its pages
  // at most (`cutHeldSlots`).
  heldSlots = cutHeldSlots(
    device.limits,
    packed.live?.pages ?? packed.pageCount,
    Math.min(VIEW_ROWS, packed.live?.pages ?? packed.pageCount),
  ),
  // The most the cut's tables may hold (`../../residency/cutTableBytes.ts`).
  share = CUT_TABLE_BYTES,
  // The session's budget asked for each buffer before it is made (`ActiveGpuMemory.cutTables`):
  // it throws, by its own name, when it cannot fund it.
  admit: CutAdmission = () => {},
  // Each sub-step named as it begins, timed (`cutSteps.ts`).
  steps?: CutSteps,
) {
  listCap ??= initialListCap(device.limits, packed.live?.pages ?? packed.pageCount, heldSlots)
  const buffers: GPUBuffer[] = [],
    textures: { texture: GPUTexture; bytes: number }[] = []
  let held = 0
  /** A buffer of this cut's: the runtime's dispose destroys them all. One past the share, or the
   *  budget refuses, is never made: the cut is refused by name. */
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = madeAsked(device, admit, held, share, descriptor)
    held += buffer.size
    buffers.push(buffer)
    return buffer
  }
  /** A record texture of this cut's (`../core/recordTexture.ts`), `bytes` large: the same
   *  admission, the same end. */
  const ownTexture = (descriptor: GPUTextureDescriptor, bytes: number) => {
    const texture = admitted(device, admit, held, share, { label: descriptor.label, bytes }, () =>
      device.createTexture(descriptor),
    )
    held += bytes
    textures.push({ texture, bytes })
    return texture
  }
  /** Every resource made so far, each destroyed whatever the others do: a partial setup must not
   *  leak. */
  const destroyAll = () => {
    for (const made of [...buffers, ...textures.map(({ texture }) => texture)])
      try {
        made.destroy()
      } catch {
        /* The next one still goes. */
      }
  }
  try {
    steps?.begin('tables')
    const { tables, ...made } = dagBuffers(device, packed, { own, ownTexture }, listCap, heldSlots)
    const { group, frames, split, work, dispatchArgs } = made
    // One validation scope after the other: the device's scopes are one stack, and two built
    // together would each pop the other's.
    const compiled = await createDagPipeline(device, group, frames, split, steps)
    steps?.begin('arm')
    const armed =
      compiled.value &&
      (await validatedOrWhy(device, () =>
        createDagArm(device, work, dispatchArgs, tables.workLayout),
      ))
    const pipeline = compiled.value,
      arm = armed?.value
    if (!pipeline || !arm) {
      destroyAll()
      refused((pipeline ? armed?.refused : compiled.refused) ?? 'the device made no pipeline')
      return undefined
    }
    steps?.begin('uploads')
    const resources = {
      device,
      packed,
      repeat,
      ...made,
      buffers,
      textures,
      own,
      ...uploadDagTables(device, packed, tables),
      ...pipeline,
      ...arm,
      /** Whose cut the mask, the journal and `out` hold (`swap.ts`). */
      swap: createMaskSwap(),
      /** The most its tables may hold, growths included (`queueGrowth.ts`, `listCap.ts`), and the
       *  budget each growth asks first. */
      share,
      admit,
    }
    // The frame's copies of the lists, read back in order: made last, within what the tables leave.
    const readbacks = createMainReadbacks(device, resources, made.readbackBytes)
    return {
      ...resources,
      readbacks,
      rankGroups: rankGroups(resources),
      // The records its groups bind, followed when a growth remakes them (`recordsFollow.ts`).
      recordsBound: recordsIdentity(made.frames.worlds.view),
    }
  } catch (error) {
    refused(error instanceof Error ? error.message : String(error))
    destroyAll()
    return undefined
  }
}

/** Every buffer of the cut, and the group its kernels bind. */
function dagBuffers(
  device: GPUDevice,
  packed: PackedDag,
  {
    own,
    ownTexture,
  }: { own: Own; ownTexture: (d: GPUTextureDescriptor, bytes: number) => GPUTexture },
  listCap: number,
  heldSlots: number,
) {
  const tables = dagTables(device, packed, own)
  const { rows, blockCount, split } = tables
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
  // No extra storage buffer in the selection's group, a stage's ceiling is already reached: the
  // arming kernel reads the list counts here through its own group.
  const work = makeDagBuffer(own, rows.work)
  const worldCount = Math.max(1, packed.worldCount)
  const { worlds, worldSources } = packed
  const frames = createCameraFrames(
    device,
    frameData,
    worldCount,
    own,
    worlds,
    worldSources,
    ownTexture,
  )
  // The placement tree's record table (`treeTable.ts`): the culling, the refit and the rays read it.
  const treeTable = createTreeTable(device, packed.placementTree, ownTexture)
  const group = { ...dagGroup(tables, uniforms, list.output, work), tree: treeTable.view }
  const { clusters, nodes, flags, cold: pageCones } = group
  return {
    tables,
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
    clusters,
    nodes,
    uniforms,
    flags,
    dispatchArgs,
    work,
    frames,
    treeTable,
    pageCones,
    /** How the tables split on this device, and each as its parts (`split.ts`). */
    split,
    flagParts: tables.flags,
    /** What `flags` holds now: its queues and lists grow on demand (`queueGrowth.ts`). */
    flagShape: tables.shape,
  }
}
