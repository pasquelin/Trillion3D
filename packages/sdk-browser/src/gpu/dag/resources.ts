import type { PackedDag } from './types.ts'
import { createDagPipeline } from './pipeline.ts'
import { dagTables } from './dagTables.ts'
import { cutHeldSlots, initialListCap, rankGroups } from './listCap.ts'
import { createDagArm } from './arm.ts'
import { validatedOrWhy } from '../core/errorScope.ts'
import { createMaskSwap } from './swap.ts'
import { VIEW_ROWS } from '../../webgpu/row/tableRows.ts'
import { CUT_TABLE_BYTES } from '../../residency/cutTableBytes.ts'
import type { CutSteps } from './cutSteps.ts'
import { cutBuffer, cutTexture, type CutAdmission, type TextureMaker } from './cutBuffers.ts'
import { createMainReadbacks } from './mainReadbacks.ts'
import { recordsIdentity } from './recordsFollow.ts'

/** The DAG's GPU resources once made (`createDagResources`). */
export type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** What a cut encodes for the row cache after its own kernels, on its pass, its group set
 *  (`../../webgpu/row/rowEviction.ts`): the rows' closure, and their victim queue when `read` — a
 *  readback copies this cut —; and what a main readback brings back of it, mapped, cut at `frame`
 *  on a list of `listCap` (`landed`): none from a cut that dropped work. Set by the session that
 *  holds the rows (`selection.ts`). */
export type RowCutPass = {
  encode(pass: GPUComputePassEncoder, read: boolean): void
  landed(range: ArrayBuffer | undefined, listCap: number, frame: number): void
}

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
  /** The cut as its setup makes it: one past the share, or the budget refuses, is never made, and
   *  the cut is refused by name. */
  const setup = { buffers, textures, device, admit, share }
  /** A buffer of this cut's: the runtime's dispose destroys them all (`cutBuffer`). */
  const own = (descriptor: GPUBufferDescriptor) => cutBuffer(setup, descriptor)
  /** A record texture of this cut's (`../core/recordTexture.ts`), `bytes` large, in `old`'s place
   *  when a table grows (`hold`): the same admission, the same end, the replaced bytes leaving it. */
  const ownTexture: TextureMaker = (descriptor, bytes, old) =>
    cutTexture(setup, descriptor, bytes, old)
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
    const made = dagTables(device, packed, { own, ownTexture }, listCap, heldSlots)
    const { group, frames, work, dispatchArgs } = made
    // One validation scope after the other: the device's scopes are one stack, and two built
    // together would each pop the other's.
    const compiled = await createDagPipeline(device, group, frames, steps)
    steps?.begin('arm')
    const armed =
      compiled.value &&
      (await validatedOrWhy(device, () =>
        createDagArm(device, work, dispatchArgs, made.workLayout),
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
      ...pipeline,
      ...arm,
      /** Whose cut the mask, the journal and `out` hold (`swap.ts`). */
      swap: createMaskSwap(),
      /** The most its tables may hold, growths included (`queueGrowth.ts`, `listGrowth.ts`), and the
       *  budget each growth asks first. */
      share,
      admit,
      /** The row cache's pass, when a session holds rows (`RowCutPass`). */
      rowPass: undefined as RowCutPass | undefined,
    }
    // The frame's copies of the lists, read back in order: made last, within what the tables leave.
    const readbacks = createMainReadbacks(resources, made.readbackBytes)
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
