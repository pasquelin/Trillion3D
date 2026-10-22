import type { PackedDag } from './types.ts'
import { createDagPipeline } from './pipeline.ts'
import { dagTables } from './dagTables.ts'
import { cutHeldSlots, listCapFor, rankGroups } from './lists/listCap.ts'
import { createMaskSwap } from './swap/swap.ts'
import { VIEW_ROWS } from '../rows/tableRows.ts'
import { CUT_TABLE_BYTES } from '../../session/memory/cutTableBytes.ts'
import type { CutSteps } from './cut/cutSteps.ts'
import { cutBuffer, cutTexture, type CutAdmission } from './cut/cutBuffers.ts'
import type { TextureMaker } from '../../gpu/core/recordTexture.ts'
import { createMainReadbacks } from './mainReadbacks.ts'
import { recordsIdentity } from './recordsFollow.ts'
import { destroyAll } from '../../gpu/core/errorScope.ts'
import { createCutOcclusion, type CutOcclusion } from './occlusion.ts'
import { cutListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import { createListFeedback, listOverflowMessage } from './lists/listFeedback.ts'
import { createRequestSize, requestBounds, type RequestBounds } from './lists/requestSize.ts'

/** The DAG's GPU resources once made (`createDagResources`). */
export type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** Where a cut says a warning of its lists, in words and with what it measured. */
export type ListNote = (message: string, details: Record<string, unknown>) => void

/** What a cut encodes for the row cache after its own kernels, on its pass, its group set
 *  (`../rows/rowEviction.ts`): the rows' closure, and their victim queue when `read` — a
 *  readback copies this cut —; and what a main readback brings back of it, mapped, cut at `frame`
 *  on a list of `listCap` (`landed`). Set by the session that holds the rows
 *  (`selection/selection.ts`). */
export type RowCutPass = {
  encode(pass: GPUComputePassEncoder, read: boolean): void
  landed(range: ArrayBuffer | undefined, listCap: number, frame: number): void
}

/** What the cut's readout is sized for: the bounds of its ranks — a readout given its ranks holds
 *  them, both bounds are them —, the open-count slots placements hold and the ranks it starts at. */
function readoutSizing(
  device: GPUDevice,
  packed: PackedDag,
  listCap: number | undefined,
  heldSlots: number | undefined,
  requests: RequestBounds,
) {
  const pages = packed.live?.pages ?? packed.pageCount
  const bounds = listCap === undefined ? requests : { min: listCap, max: listCap }
  const slots =
    heldSlots ?? cutHeldSlots(device.limits, pages, Math.min(VIEW_ROWS, pages), bounds.min)
  return { bounds, slots, ranks: listCap ?? listCapFor(device.limits, pages, bounds.min, slots) }
}

/** The cut's buffers, pipelines and groups, or `undefined` when the device refuses them: why is
 *  told to `refused` by the device's own words, never swallowed. */
export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  repeat: 'all' | 'head' | null = null,
  // The readout's ranks, held for its life when given; else the least the settings allow within
  // the pages its roots hold (`listCapFor`), then what the cut asks of it (`requestSize.ts`).
  listCap?: number,
  refused: (reason: string) => void = () => {},
  // The open counts placements hold of their own follow what the row cache holds resident
  // (`heldOpen.ts`): a cut made beside none sizes them for the rows a view starts with, its pages
  // at most (`cutHeldSlots`).
  heldSlots?: number,
  // The most the cut's tables may hold (`../../session/memory/cutTableBytes.ts`).
  share = CUT_TABLE_BYTES,
  // The session's budget asked for each buffer before it is made (`ActiveGpuMemory.cutTables`):
  // it throws, by its own name, when it cannot fund it.
  admit: CutAdmission = () => {},
  // Each sub-step named as it begins, timed (`cut/cutSteps.ts`).
  steps?: CutSteps,
  // The caps its lists are laid out for (`lists/cutListCaps.ts`): the session's settings.
  lists: CutListCaps = cutListCaps(),
  // The least and the most ranks the readout holds: the session's settings.
  requests: RequestBounds = requestBounds(),
  // The project switch: the cut culls by a view's clip plane.
  clipPlane = false,
) {
  const { bounds, slots, ranks } = readoutSizing(device, packed, listCap, heldSlots, requests)
  const buffers: GPUBuffer[] = [],
    textures: { texture: GPUTexture; bytes: number }[] = []
  /** The cut as its setup makes it: one past the share, or the budget refuses, is never made, and
   *  the cut is refused by name. */
  const setup = { buffers, textures, device, admit, share }
  /** A buffer of this cut's: the runtime's dispose destroys them all (`cutBuffer`). */
  const own = (descriptor: GPUBufferDescriptor) => cutBuffer(setup, descriptor)
  /** A record texture of this cut's (`../../gpu/core/recordTexture.ts`), `bytes` large, in `old`'s place
   *  when a table grows (`hold`): the same admission, the same end, the replaced bytes leaving it. */
  const ownTexture: TextureMaker = (descriptor, bytes, old) =>
    cutTexture(setup, descriptor, bytes, old)
  let occlusion: CutOcclusion | undefined
  const release = () => {
    destroyAll([...buffers, ...textures.map(({ texture }) => texture)])
    occlusion?.dispose()
  }
  try {
    // The pyramid the cut's occlusion reads, a blank one until a frame binds its own
    // (`occlusion.ts`): made here, so a device that refuses it refuses the cut by name.
    occlusion = createCutOcclusion(device)
    steps?.begin('tables')
    const made = dagTables(device, packed, { own, ownTexture }, ranks, slots, lists)
    const { group, frames, work, dispatchArgs } = made
    // The stages and the arming kernel, asked in one batch under one validation scope.
    const arm = { work, args: dispatchArgs, words: made.workLayout }
    const compiled = await createDagPipeline(
      device,
      group,
      frames,
      arm,
      occlusion.layout,
      steps,
      clipPlane,
    )
    const pipeline = compiled.value
    if (!pipeline) {
      release()
      refused(compiled.refused ?? 'the device made no pipeline')
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
      occlusion,
      /** Whose cut the mask, the journal and `out` hold (`swap/swap.ts`). */
      swap: createMaskSwap(),
      /** The most its tables may hold, those made again included (`queueGrowth.ts`,
       *  `lists/listGrowth.ts`), and the budget each one asks first. */
      share,
      admit,
      /** The row cache's pass, when a session holds rows (`RowCutPass`). */
      rowPass: undefined as RowCutPass | undefined,
      /** Where the cut says its lists' warnings — an overflow, caps refused —, set by the session
       *  that says them (`selection/selection.ts`); none, unsaid. */
      listNote: undefined as ListNote | undefined,
      /** The ranks its readout holds, followed after each readback (`lists/requestSize.ts`). */
      requestSize: createRequestSize(bounds),
      /** The filter bits `work` holds for the cut in hand (`viewFilterRegion.ts`). */
      filterHeld: { bits: undefined as Uint32Array | undefined },
    }
    // The frame's copies of the lists, read back in order: made last, within what the tables leave.
    const readbacks = createMainReadbacks(resources, made.readbackBytes)
    const cut = {
      ...resources,
      readbacks,
      rankGroups: rankGroups(resources),
      // The records its groups bind, followed when a growth remakes them (`recordsFollow.ts`).
      recordsBound: recordsIdentity(made.frames.worlds.view),
    }
    // The high-water marks of its lists, what each readback asked of them noted against the caps
    // they hold (`lists/listFeedback.ts`), an overflow that raises one said where `listNote` says.
    const listFeedback = createListFeedback((overflow) =>
      cut.listNote?.(listOverflowMessage(overflow), overflow),
    )
    return Object.assign(cut, { listFeedback })
  } catch (error) {
    refused(error instanceof Error ? error.message : String(error))
    // A partial setup must not leak.
    release()
    return undefined
  }
}
