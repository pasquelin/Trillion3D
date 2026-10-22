import { validated } from '../../gpu/core/errorScope.ts'
import { behind } from '../../gpu/core/behind.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'
import {
  JOURNAL_SECTION,
  dagFlagShape,
  flagSectionStart,
  sameFlagShape,
  type FlagShape,
} from './flagSections.ts'
import { createFlagTable } from './cut/cutTables.ts'
import { admitBeside } from './cut/cutBuffers.ts'
import { cutHeldSlots, heldOpenAt, listCapFor, rankGroups } from './lists/listCap.ts'
import { growDagList } from './lists/listGrowth.ts'
import { sameListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import { regionsWanted } from './swap/swap.ts'
import { recutMain, recutView, type DagRuntimeState } from './runtime/runtimeState.ts'
import type { CutTablesAt } from './uniforms.ts'
import type { DagResources } from './resources.ts'

/**
 * THE CUT'S TABLES MADE AGAIN BETWEEN TWO FRAMES, behind the readbacks in flight: its flags laid
 * out anew for the lists' caps the session asks (`holdListCaps`), its readout for the regions the
 * views aside ask, the open counts the row cache holds (`followRows`) and the ranks its lists hold
 * as what each readback asked of them moves them (`askListCap`). No GPU list grows on demand: a
 * cut past a cap draws what fits (`shader/listsWgsl.ts`).
 */

/** Where `resources`' tables lie for its kernels: the open counts in `out`, its flags' shape. */
export const cutTablesAt = (resources: {
  listCap: number
  heldSlots: number
  swap: { regions: number }
  flagShape: FlagShape
  workLayout: { filter: number }
}): CutTablesAt => ({
  ...heldOpenAt(resources),
  shape: resources.flagShape,
  filter: resources.workLayout.filter,
})

/** The lists' caps the session asks of the cut from its next cut on (`GpuSelection.holdLists`):
 *  caps that lay the flags out as they are hold from now; others are laid out before the next cut
 *  (`queueDagGrowth`), unless the device refused them already. */
export function holdListCaps(resources: DagResources, state: DagRuntimeState, caps: CutListCaps) {
  const asked = state.reshape?.caps ?? resources.listCaps
  if (sameListCaps(asked, caps) || (state.refusedCaps && sameListCaps(state.refusedCaps, caps)))
    return
  const shape = dagFlagShape(resources.packed, caps)
  state.reshape = sameFlagShape(shape, resources.flagShape) ? undefined : { caps, shape }
  if (!state.reshape) resources.listCaps = caps
}

/** The readout's ranks after a readback that asked `demand` of its lists (`requestSize.ts`): when
 *  their size moved, or the catalogue grew into it, the readout is made for it before the next
 *  cut, unless that is more than the device or the cut's share already refused. A request that
 *  cannot start yet, a copy being in flight, stands until it is made or the size comes back. */
export function askListCap(resources: DagResources, state: DagRuntimeState, demand: number) {
  const { requestSize, packed, device, listCap } = resources
  const moved = requestSize.update(demand)
  const wanted = listCapFor(
    device.limits,
    packed.live?.pages ?? packed.pageCount,
    requestSize.ranks,
    resources.heldSlots,
  )
  const refused = state.refusedList > 0 && wanted >= state.refusedList
  // A request that stands — a shrink asked while a copy was still in flight — is kept and re-aimed
  // by the next reading, and only cancelled when the readout already has the size wanted.
  const standing = state.growList > 0
  const asked = wanted > listCap || moved || standing
  state.growList = wanted === listCap || refused || !asked ? 0 : wanted
}

/**
 * Gives the cut a `flags` of `shape`, between two frames and with no readback in flight: its record
 * table made within the cut's share under an out-of-memory scope (`createFlagTable`), the drawn
 * log carried over to its new place, the bind groups made again and the old table retired. A
 * device that refuses keeps the old `flags` whole and says `false`: the lists keep the caps they
 * hold. One layout and one text whatever the shape: nothing compiles again.
 */
async function remakeDagFlags(resources: DagResources, shape: FlagShape, disposed: () => boolean) {
  const { device, cutTables } = resources,
    old = cutTables.flags
  // What the flags replace leaves the share: the new table is made within what remains, beside
  // what it made so far (`admitBeside`).
  const admission = admitBeside<GPUTexture>(resources, old.bytes)
  const make = (descriptor: GPUTextureDescriptor, bytes: number) =>
    admission.admit({ label: descriptor.label, bytes }, () => device.createTexture(descriptor))
  // A creation the device throws on is a refusal too.
  const flags = await validated(
    device,
    () => createFlagTable(device, shape, make),
    'out-of-memory',
  ).catch(() => undefined)
  const { made } = admission
  const growth = pendingMade(
    device,
    made.map(({ resource }) => resource),
    flags?.bytes ?? 0,
    () => {
      const grown = flags!
      carryJournal(resources, grown, shape)
      const at = resources.textures.findIndex(({ texture }) => texture === old.texture)
      resources.textures.splice(
        at,
        1,
        ...made.map(({ resource, bytes }) => ({ texture: resource, bytes })),
      )
      cutTables.flags = grown
      resources.flagShape = shape
      resources.group.flags = grown.view
      resources.bindGroup = resources.frames.bindGroup(resources.layout, resources.group)
      resources.rankGroups = rankGroups(resources)
      return [old.texture]
    },
  )
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (!flags || disposed()) {
    growth.destroy()
    return false
  }
  growth.commit()
  return true
}

/** The section a cut keeps across cuts (`JOURNAL_SECTION`) copied from `resources`' flags into
 *  `flags`, laid out for `shape`, at its new place. */
function carryJournal(resources: DagResources, flags: { texture: GPUTexture }, shape: FlagShape) {
  const from = resources.flagShape,
    encoder = resources.device.createCommandEncoder()
  resources.cutTables.flags.copyTexels(
    encoder,
    flags,
    'Word',
    flagSectionStart(JOURNAL_SECTION, from),
    flagSectionStart(JOURNAL_SECTION, shape),
    Math.min(from.visCap, shape.visCap),
  )
  resources.device.queue.submit([encoder.finish()])
}

/** Lays `flags` out for the caps `state.reshape` asks, and makes `out` again for the regions the
 *  views aside ask, the open counts the row cache holds (`state.growHeld`) and the ranks its lists
 *  hold (`state.growList`), behind the readbacks in `state.pending`; no frame cuts until each is in
 *  place or refused, and the next one cuts and reads again — on the new tables, or, refused, on
 *  the lists at the caps they hold (said once a caps asked, `listNote`), the views aside without a
 *  region, more open counts at their nodes' (`heldOpen.ts`), the ranks they have. */
function queueDagGrowth(resources: DagResources, state: DagRuntimeState) {
  const { swap } = resources,
    reshape = state.reshape,
    held = Math.max(state.growHeld, resources.heldSlots),
    regions = state.regionsFull ? swap.regions : Math.max(swap.regions, regionsWanted(swap)),
    ranks = state.growList || resources.listCap
  state.reshape = undefined
  state.growHeld = 0
  state.growList = 0
  state.growing = true
  void behind(state, async () => {
    try {
      // Every view's cut in hand stood on the old lists: each cuts again.
      if (reshape) {
        const made = await remakeDagFlags(resources, reshape.shape, () => state.disposed)
        reshapeLists(resources, state, reshape, made)
      }
      if (regions === swap.regions && held === resources.heldSlots && ranks === resources.listCap)
        return
      if (await growDagList(resources, regions, () => state.disposed, held, ranks)) return
      if (ranks > resources.listCap) state.refusedList = ranks
      if (regions > swap.regions) state.regionsFull = true
    } finally {
      state.growing = false
      recutMain(swap, state)
      if (reshape) swap.cuts.forEach((_, v) => recutView(swap, v + 1))
    }
  })
}

/** The lists laid out for `asked` (`made`), its caps the cut's from now; or refused, their caps
 *  kept, and said once: the session asking them again is not tried again (`holdListCaps`). */
function reshapeLists(
  resources: DagResources,
  state: DagRuntimeState,
  asked: { caps: CutListCaps; shape: FlagShape },
  made: boolean,
) {
  if (made) {
    resources.listCaps = asked.caps
    state.refusedCaps = undefined
    return
  }
  state.refusedCaps = asked.caps
  resources.listNote?.(
    'The device or the cut’s share holds no lists at the caps asked: they keep the caps they hold',
    { asked: asked.caps, held: resources.listCaps },
  )
}

/** True when the flags must be laid out again, or `out` must hold the saved regions the views
 *  aside ask, the open counts the row cache holds or the ranks the cut's demand moved. */
export const growthAsked = (resources: DagResources, state: DagRuntimeState) =>
  !!state.reshape ||
  state.growHeld > resources.heldSlots ||
  state.growList > 0 ||
  (!state.regionsFull && regionsWanted(resources.swap) > resources.swap.regions)

/** True when no cut may run on the tables now: disposed, lost, or tables to make again — which
 *  wait for the readbacks in flight, then are made (`queueDagGrowth`): no frame cuts on the old
 *  ones. The main view's dispatch (`dispatch.ts`) and a view's aside (`aside.ts`) alike. */
export function tablesHeld(resources: DagResources, state: DagRuntimeState) {
  if (state.disposed || state.dead || state.growing) return true
  if (!growthAsked(resources, state)) return false
  if (!resources.readbacks.held()) queueDagGrowth(resources, state)
  return true
}

/**
 * The row cache now holds `rows` rows (`../../frame/prepare/growTables.ts`): the open counts
 * the cut's placements hold follow it, on its readout's growth path, before the next cut. The table
 * is an accelerator — an entry it cannot place leaves its node's count — so it never refuses a row,
 * and it grows only once the row cache did.
 */
export function followRows(resources: DagResources, state: DagRuntimeState, rows: number) {
  if (!resources.heldSlots) return
  const { device, packed } = resources,
    slots = cutHeldSlots(
      device.limits,
      packed.live?.pages ?? packed.pageCount,
      rows,
      resources.requestSize.bounds.min,
    )
  if (slots > resources.heldSlots) state.growHeld = Math.max(state.growHeld, slots)
}
