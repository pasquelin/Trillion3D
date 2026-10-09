import type { PackedDag } from './types.ts'
import { primitiveFrameWords } from './worlds.ts'
import { createCameraFrames } from './frameRanges.ts'
import { createDagPipeline } from './pipeline.ts'
import { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts'
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
import { ledgerTentative } from '../core/deviceLedger.ts'
import type { CutSteps } from './cutSteps.ts'

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
  const buffers: GPUBuffer[] = []
  let held = 0
  /** A buffer of this cut's: the runtime's dispose destroys them all. One past the share, or the
   *  budget refuses, is never made: the cut is refused by name. */
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = madeAsked(device, admit, held, share, descriptor)
    held += buffer.size
    buffers.push(buffer)
    return buffer
  }
  try {
    steps?.begin('tables')
    const { tables, ...made } = dagBuffers(device, packed, own, listCap, heldSlots)
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
      for (const buffer of buffers) buffer.destroy()
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
    return { ...resources, rankGroups: rankGroups(resources) }
  } catch (error) {
    refused(error instanceof Error ? error.message : String(error))
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
function dagBuffers(
  device: GPUDevice,
  packed: PackedDag,
  own: Own,
  listCap: number,
  heldSlots: number,
) {
  const tables = dagTables(device, packed, own)
  const { rows, blockCount, split } = tables
  // The camera's block, then the view ahead's (`shader/aheadWgsl.ts`).
  const uniformData = new Float32Array((AHEAD_VIEW + 1) * DAG_VIEW_WORDS)
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
  const frames = createCameraFrames(device, frameData, worldCount, own, worlds, worldSources)
  const group = dagGroup(tables, uniforms, list.output, work)
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
    pageCones,
    /** How the tables split on this device, and each as its parts (`split.ts`). */
    split,
    flagParts: tables.flags,
    /** What `flags` holds now: its queues and lists grow on demand (`queueGrowth.ts`). */
    flagShape: tables.shape,
  }
}

/** The session's budget asked for a buffer of `bytes` more of the cut's tables: it throws, by its
 *  own name, when it cannot fund them. */
export type CutAdmission = (bytes: number) => void

/** Every buffer of a cut's tables starts so: what the budget counts as their share
 *  (`cutLedgerBytes`). */
const CUT_LABEL = 'Trillion3D DAG'

/** The refusal of a cut whose tables would hold `bytes`, past its `share`: said by name. */
const pastShare = (bytes: number, share: number) =>
  new Error(`GPU_CUT_TABLES_PAST_SHARE: ${bytes} > ${share}`)

/**
 * The one way a buffer of a cut's tables is made, beside the `held` bytes they hold: within the
 * `share`, the session's budget asked first (`admit`), and made tentatively on its ledger — the cut
 * has a fallback, a coarser cut or the CPU's, so a refusal never refuses the session
 * (`ledgerTentative`).
 */
export function madeAsked(
  device: GPUDevice,
  admit: CutAdmission,
  held: number,
  share: number,
  descriptor: GPUBufferDescriptor,
) {
  if (held + descriptor.size > share) throw pastShare(held + descriptor.size, share)
  if (!descriptor.label?.startsWith(CUT_LABEL)) throw new Error(`GPU_CUT_BUFFER_UNNAMED`)
  admit(descriptor.size)
  return ledgerTentative(device, () => device.createBuffer(descriptor))
}

/** Bytes a ledger's labels give the cuts' tables (`CUT_LABEL`). */
export const cutLedgerBytes = (byLabel: Readonly<Record<string, number>>) =>
  Object.entries(byLabel).reduce(
    (sum, [label, bytes]) => sum + (label.startsWith(CUT_LABEL) ? bytes : 0),
    0,
  )

/** Bytes the cut's buffers hold. */
export const cutBytes = (resources: { buffers: readonly GPUBuffer[] }) =>
  resources.buffers.reduce((sum, buffer) => sum + buffer.size, 0)
