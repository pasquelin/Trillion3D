import { validated } from '../../gpu/core/errorScope.ts'
import { behind } from '../../gpu/core/behind.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'
import { dagFlagShape, sameFlagShape, type FlagShape } from './flagSections.ts'
import { rebindCut } from './recordsFollow.ts'
import { createFlagTable } from './cut/cutTables.ts'
import { admitBeside } from './cut/cutBuffers.ts'
import { cutHeldSlots, heldOpenAt, listCapFor } from './lists/listCap.ts'
import { growDagList } from './lists/listGrowth.ts'
import { limitedCaps, sameListCaps, type CutListCaps } from './lists/cutListCaps.ts'
import { askVisibleCap, growVisible } from './visible/visibleGrowth.ts'
import { recutMain, recutView, type DagRuntimeState } from './runtime/runtimeState.ts'
import type { CutTablesAt } from './uniforms.ts'
import type { DagResources } from './resources.ts'

/**
 * THE CUT'S TABLES MADE AGAIN BETWEEN TWO FRAMES, behind the readbacks in flight: its flags laid
 * out anew for the lists' caps the session asks (`holdListCaps`), its readout for the open counts
 * the visible list's room moves and the ranks its lists hold as what each readback
 * asked of them moves them (`askListCap`), its list of visible clusters for the room each
 * readback's peak asks (`../visible/visibleGrowth.ts`). No GPU list grows on demand: a cut past a
 * cap draws what fits (`shader/listsWgsl.ts`).
 */

/** Where `resources`' tables lie for its kernels: the open counts in `out`, its flags' shape, the
 *  room of its visible list. */
export const cutTablesAt = (resources: {
  listCap: number
  heldSlots: number
  flagShape: FlagShape
  workLayout: { filter: number }
  visibleCap: number
}): CutTablesAt => ({
  ...heldOpenAt(resources),
  shape: resources.flagShape,
  filter: resources.workLayout.filter,
  visibleCap: resources.visibleCap,
})

/** The lists' caps the session asks of the cut from its next cut on (`GpuSelection.holdLists`):
 *  caps that lay the flags out as they are hold from now; others are laid out before the next cut
 *  (`queueDagGrowth`), unless the device refused them already. */
export function holdListCaps(resources: DagResources, state: DagRuntimeState, wanted: CutListCaps) {
  const caps = limitedCaps(wanted, resources.device.limits)
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
export function askListCap(
  resources: DagResources,
  state: DagRuntimeState,
  demand: number,
  peaks?: { visible: number },
) {
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
  // The visible list's room follows the most a pass asked of it.
  if (peaks) askVisibleCap(resources, state, peaks.visible)
}

/**
 * Gives the cut a `flags` of `shape`, between two frames and with no readback in flight: its record
 * table made within the cut's share under an out-of-memory scope (`createFlagTable`), the bind
 * groups made again and the old table retired. A
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
      const at = resources.textures.findIndex(({ texture }) => texture === old.texture)
      resources.textures.splice(
        at,
        1,
        ...made.map(({ resource, bytes }) => ({ texture: resource, bytes })),
      )
      cutTables.flags = grown
      resources.flagShape = shape
      resources.group.flags = grown.view
      rebindCut(resources)
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

/** Lays `flags` out for the caps `state.reshape` asks, and makes the visible list again for the
 *  room its peak asks (`state.growVisible`) and `out` again for the open counts the visible list's
 *  room moves and the ranks its lists hold (`state.growList`), behind the
 *  readbacks in `state.pending`; no frame cuts until each is in place or refused, and the next one
 *  cuts and reads again — on the new tables, or, refused, on the lists at the caps they hold (said
 *  once a caps asked, `listNote`), the room they have, more open counts at their nodes'
 *  (`heldOpen.ts`), the ranks they have. */
function queueDagGrowth(resources: DagResources, state: DagRuntimeState) {
  const { owner } = resources,
    reshape = state.reshape,
    visible = state.growVisible || resources.visibleCap
  let held = resources.heldSlots
  const ranks = state.growList || resources.listCap
  state.reshape = undefined
  state.growList = 0
  state.growVisible = 0
  state.growing = true
  void behind(state, async () => {
    try {
      // Every view's cut in hand stood on the old lists: each cuts again.
      if (reshape) {
        const made = await remakeDagFlags(resources, reshape.shape, () => state.disposed)
        reshapeLists(resources, state, reshape, made)
      }
      if (visible > resources.visibleCap) {
        if (await growVisible(resources, visible, () => state.disposed))
          // The open counts follow the room the visible list gave.
          held = Math.max(held, followedSlots(resources, visible))
        else state.refusedVisible = visible
      }
      if (held === resources.heldSlots && ranks === resources.listCap) return
      if (await growDagList(resources, () => state.disposed, held, ranks)) return
      if (ranks > resources.listCap) state.refusedList = ranks
    } finally {
      state.growing = false
      recutMain(owner, state)
      if (reshape || visible > resources.visibleCap)
        owner.cuts.forEach((_, v) => recutView(owner, v + 1))
    }
  })
}

/** The slots of open counts a visible list of `rows` records asks. */
const followedSlots = (resources: DagResources, rows: number) =>
  cutHeldSlots(
    resources.device.limits,
    resources.packed.live?.pages ?? resources.packed.pageCount,
    rows,
    resources.requestSize.bounds.min,
  )

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

/** True when the flags must be laid out again, or the visible list must hold the room its peak
 *  asked, or `out` the open counts they follow or the ranks the cut's demand moved. */
export const growthAsked = (resources: DagResources, state: DagRuntimeState) =>
  !!state.reshape || state.growVisible > resources.visibleCap || state.growList > 0

/** True when no cut may run on the tables now: disposed, lost, or tables to make again — which
 *  wait for the readbacks in flight, then are made (`queueDagGrowth`): no frame cuts on the old
 *  ones. The main view's dispatch (`dispatch.ts`) and a view's aside (`aside.ts`) alike. */
export function tablesHeld(resources: DagResources, state: DagRuntimeState) {
  if (state.disposed || state.dead || state.growing) return true
  if (!growthAsked(resources, state)) return false
  if (!resources.readbacks.held()) queueDagGrowth(resources, state)
  return true
}
