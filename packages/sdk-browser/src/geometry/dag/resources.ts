import type { PackedDag } from './types.ts'
import { createDagPipeline } from './pipeline.ts'
import { dagTables } from './dagTables.ts'
import { cutHeldSlots, listCapFor } from './lists/listCap.ts'
import { createCutOwner } from './owner/cutOwner.ts'
import { INITIAL_VISIBLE } from './visible/layout.ts'
import { CUT_TABLE_BYTES } from '../../session/memory/cutTableBytes.ts'
import type { CutSteps } from './cut/cutSteps.ts'
import { cutBuffer, cutTexture, type CutAdmission } from './cut/cutBuffers.ts'
import type { TextureMaker } from '../../gpu/core/recordTexture.ts'
import { createMainReadbacks } from './mainReadbacks.ts'
import { recordsIdentity } from './recordsFollow.ts'
import { destroyAll } from '../../gpu/core/errorScope.ts'
import { createCutOcclusion, type CutOcclusion } from './occlusion.ts'
import { cutListCaps, limitedCaps, type CutListCaps } from './lists/cutListCaps.ts'
import { createListFeedback, listOverflowMessage } from './lists/listFeedback.ts'
import { createRequestSize, requestBounds, type RequestBounds } from './lists/requestSize.ts'

/** The DAG's GPU resources once made (`createDagResources`). */
export type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/** Where a cut says a warning of its lists, in words and with what it measured. */
export type ListNote = (message: string, details: Record<string, unknown>) => void

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
    heldSlots ?? cutHeldSlots(device.limits, pages, Math.min(INITIAL_VISIBLE, pages), bounds.min)
  return { bounds, slots, ranks: listCap ?? listCapFor(device.limits, pages, bounds.min, slots) }
}

/** What `createDagResources` made before the cut: its buffers and textures, the tables, the
 *  pipeline, the pyramid it reads and the way it is released. */
type CutParts = {
  device: GPUDevice
  packed: PackedDag
  repeat: 'all' | 'head' | null
  made: ReturnType<typeof dagTables>
  buffers: GPUBuffer[]
  textures: { texture: GPUTexture; bytes: number }[]
  own: (descriptor: GPUBufferDescriptor) => GPUBuffer
  pipeline: NonNullable<Awaited<ReturnType<typeof createDagPipeline>>['value']>
  occlusion: CutOcclusion
  release: () => void
  share: number
  admit: CutAdmission
  bounds: RequestBounds
}

/** The cut over its parts: the resources, its readbacks and its lists' feedback. */
function assembleCut(parts: CutParts) {
  const { made, bounds, pipeline, ...rest } = parts
  const resources = {
    device: rest.device,
    packed: rest.packed,
    repeat: rest.repeat,
    ...made,
    buffers: rest.buffers,
    textures: rest.textures,
    own: rest.own,
    ...pipeline,
    occlusion: rest.occlusion,
    /** Destroys every buffer and texture the cut made and its pyramid. */
    release: rest.release,
    /** Whose cut `out` holds (`owner/cutOwner.ts`). */
    owner: createCutOwner(),
    /** The most its tables may hold, those made again included (`queueGrowth.ts`,
     *  `lists/listGrowth.ts`), and the budget each one asks first. */
    share: rest.share,
    admit: rest.admit,
    /** Where the cut says its lists' warnings — an overflow, caps refused —, set by the session
     *  that says them (`selection/selection.ts`); none, unsaid. */
    listNote: undefined as ListNote | undefined,
    /** The ranks its readout holds, followed after each readback (`lists/requestSize.ts`). */
    requestSize: createRequestSize(bounds),
    /** The filter bits `work` holds for the cut in hand (`viewFilterRegion.ts`). */
    filterHeld: { bits: undefined as Uint32Array | undefined },
    /** The casters' bits `work` holds for the sun's shadows (`viewFilterRegion.ts`, `holdViewFilter`). */
    castersHeld: { bits: undefined as Uint32Array | undefined },
  }
  // The frame's copies of the lists, read back in order: made last, within what the tables leave.
  const readbacks = createMainReadbacks(resources, made.readbackBytes)
  const cut = {
    ...resources,
    readbacks,
    // The records its groups bind, followed when a growth remakes them (`recordsFollow.ts`).
    recordsBound: recordsIdentity(made.frames.worlds.view),
  }
  // The high-water marks of its lists, what each readback asked of them noted against the caps
  // they hold (`lists/listFeedback.ts`), an overflow that raises one said where `listNote` says.
  const listFeedback = createListFeedback((overflow) =>
    cut.listNote?.(listOverflowMessage(overflow), overflow),
  )
  return Object.assign(cut, { listFeedback })
}

/** The buffers and textures a cut makes, and the way they are released with the pyramid `held`
 *  names: one past the share, or the budget refuses, is never made, and the cut is refused by
 *  name. */
function cutSetup(device: GPUDevice, admit: CutAdmission, share: number) {
  const buffers: GPUBuffer[] = [],
    textures: { texture: GPUTexture; bytes: number }[] = []
  const held: { occlusion: CutOcclusion | undefined } = { occlusion: undefined }
  const setup = { buffers, textures, device, admit, share }
  /** A buffer of this cut's: the runtime's dispose destroys them all (`cutBuffer`). */
  const own = (descriptor: GPUBufferDescriptor) => cutBuffer(setup, descriptor)
  /** A record texture of this cut's (`../../gpu/core/recordTexture.ts`), `bytes` large, in `old`'s place
   *  when a table grows (`hold`): the same admission, the same end, the replaced bytes leaving it. */
  const ownTexture: TextureMaker = (descriptor, bytes, old) =>
    cutTexture(setup, descriptor, bytes, old)
  const release = () => {
    destroyAll([...buffers, ...textures.map(({ texture }) => texture)])
    held.occlusion?.dispose()
  }
  return { buffers, textures, own, ownTexture, release, held }
}

/**
 * The cut's buffers, pipelines and groups, or `undefined` when the device refuses them: why is
 * told to `refused` by the device's own words, never swallowed.
 *
 * `listCap`: the readout's ranks, held for its life when given; else the least the settings allow
 * within the pages its roots hold (`listCapFor`), then what the cut asks of it (`requestSize.ts`).
 * `heldSlots`: the open counts placements hold of their own follow what the view holds resident
 * (`heldOpen.ts`); a cut made beside none sizes them for the rows a view starts with, its pages at
 * most (`cutHeldSlots`). `share`: the most the cut's tables may hold
 * (`../../session/memory/cutTableBytes.ts`). `admit`: the session's budget asked for each buffer
 * before it is made (`ActiveGpuMemory.cutTables`); it throws, by its own name, when it cannot fund
 * it. `steps`: each sub-step named as it begins, timed (`cut/cutSteps.ts`). `lists`: the caps its
 * lists are laid out for (`lists/cutListCaps.ts`), the session's settings. `requests`: the least
 * and the most ranks the readout holds, the session's settings. `clipPlane`: the project switch,
 * the cut culls by a view's clip plane.
 */
export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  repeat: 'all' | 'head' | null = null,
  listCap?: number,
  refused: (reason: string) => void = () => {},
  heldSlots?: number,
  share = CUT_TABLE_BYTES,
  admit: CutAdmission = () => {},
  steps?: CutSteps,
  lists: CutListCaps = cutListCaps(),
  requests: RequestBounds = requestBounds(),
  clipPlane = false,
) {
  const { bounds, slots, ranks } = readoutSizing(device, packed, listCap, heldSlots, requests)
  const { buffers, textures, own, ownTexture, release, held } = cutSetup(device, admit, share)
  try {
    // The pyramid the cut's occlusion reads, a blank one until a frame binds its own
    // (`occlusion.ts`): made here, so a device that refuses it refuses the cut by name.
    const occlusion = (held.occlusion = createCutOcclusion(device))
    steps?.begin('tables')
    const limited = limitedCaps(lists, device.limits)
    const made = dagTables(device, packed, { own, ownTexture }, ranks, slots, limited)
    const { group, frames, work, dispatchArgs } = made
    // The stages and the arming kernel, asked in one batch under one validation scope.
    const arm = { work, args: dispatchArgs, words: made.workLayout }
    const layout = occlusion.layout
    const compiled = await createDagPipeline(device, group, frames, arm, layout, steps, clipPlane)
    const pipeline = compiled.value
    if (!pipeline) {
      release()
      refused(compiled.refused ?? 'the device made no pipeline')
      return undefined
    }
    steps?.begin('uploads')
    return assembleCut({
      device,
      packed,
      repeat,
      made,
      buffers,
      textures,
      own,
      pipeline,
      occlusion,
      release,
      share,
      admit,
      bounds,
    })
  } catch (error) {
    refused(error instanceof Error ? error.message : String(error))
    // A partial setup must not leak.
    release()
    return undefined
  }
}
