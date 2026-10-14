import { validationScope } from '../core/errorScope.ts'
import { pendingMade } from '../core/tableGrowth.ts'
import { JOURNAL_SECTION, flagSectionStart, type FlagShape } from './flagSections.ts'
import { createFlagTable } from './cutTables.ts'
import { cutBytes, cutTexture } from './cutBuffers.ts'
import { cutHeldSlots, heldOpenAt, rankGroups } from './listCap.ts'
import { growDagList } from './listGrowth.ts'
import { regionsWanted } from './swap.ts'
import { recutMain, recutView, type DagRuntimeState } from './runtimeState.ts'
import type { CutTablesAt } from './uniforms.ts'
import type { DagResources } from './resources.ts'

/** Where `resources`' tables lie for its kernels: the open counts in `out`, its flags' shape. */
export const cutTablesAt = (resources: {
  listCap: number
  heldSlots: number
  swap: { regions: number }
  flagShape: FlagShape
}): CutTablesAt => ({
  ...heldOpenAt(resources),
  queueWords: resources.flagShape.queueWords,
  candCap: resources.flagShape.candCap,
})

/**
 * Gives the cut a `flags` of `shape`, between two frames and with no readback in flight: its record
 * table made within the cut's share under an out-of-memory scope (`createFlagTable`), the drawn
 * log carried over to its new place, the bind groups made again and the old table retired. A
 * device that refuses keeps the old `flags` whole and says `false`: the next cut that drops work
 * coarsens instead. One layout and one text whatever the shape: nothing compiles again.
 */
async function growDagFlags(resources: DagResources, shape: FlagShape, disposed: () => boolean) {
  const { device, cutTables } = resources,
    old = cutTables.flags
  const made: { texture: GPUTexture; bytes: number }[] = []
  // What the flags replace leaves the share: the new table is made within what remains.
  const growth = {
    buffers: [],
    textures: made,
    aside: cutBytes(resources) - old.bytes,
    device,
    admit: resources.admit,
    share: resources.share,
  }
  const make = (descriptor: GPUTextureDescriptor, bytes: number) =>
    cutTexture(growth, descriptor, bytes)
  let flags: ReturnType<typeof createFlagTable> | undefined
  try {
    const { value, error } = await validationScope(
      device,
      () => createFlagTable(device, shape, resources.pageCount, make),
      'out-of-memory',
    )
    if (!error) flags = value
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  if (!flags || disposed()) {
    for (const { texture } of made) texture.destroy()
    return false
  }
  const grown = flags
  pendingMade(
    device,
    made.map(({ texture }) => texture),
    grown.bytes,
    () => {
      carryJournal(resources, grown, shape)
      const at = resources.textures.findIndex(({ texture }) => texture === old.texture)
      resources.textures.splice(at, 1, ...made)
      cutTables.flags = grown
      resources.flagShape = shape
      resources.group.flags = grown.view
      resources.bindGroup = resources.frames.bindGroup(resources.layout, resources.group)
      resources.rankGroups = rankGroups(resources)
      return [old.texture]
    },
  ).commit()
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
    from.candCap,
  )
  resources.device.queue.submit([encoder.finish()])
}

/** Grows `flags` to `state.growFlags`, the list to `state.grow`, and `out` to the regions the views
 *  aside ask and the open counts the row cache holds (`state.growHeld`), behind the readbacks in
 *  `state.pending`; no frame cuts until each is in place or refused, and the next one cuts and reads
 *  again — on the grown tables, or, refused, to coarsen the cut past them (`coarsening.ts`), draw
 *  the views aside without a region, and leave more open counts at their nodes' (`heldOpen.ts`). */
function queueDagGrowth(resources: DagResources, state: DagRuntimeState) {
  const { swap } = resources,
    flags = state.growFlags,
    cap = Math.max(state.grow, resources.listCap),
    held = Math.max(state.growHeld, resources.heldSlots),
    regions = state.regionsFull ? swap.regions : Math.max(swap.regions, regionsWanted(swap))
  state.grow = 0
  state.growFlags = undefined
  state.growHeld = 0
  state.growing = true
  state.pending = state.pending
    .catch(() => {})
    .then(async () => {
      try {
        // Every view's cut in hand dropped work or stood on the old queues: each cuts again.
        if (flags && !(await growDagFlags(resources, flags, () => state.disposed)))
          state.flagsFull = true
        if (cap === resources.listCap && regions === swap.regions && held === resources.heldSlots)
          return
        if (await growDagList(resources, cap, regions, () => state.disposed, held)) return
        if (cap > resources.listCap) state.listFull = true
        if (regions > swap.regions) state.regionsFull = true
      } finally {
        state.growing = false
        recutMain(swap, state)
        if (flags) swap.cuts.forEach((_, v) => recutView(swap, v + 1))
      }
    })
}

/** True when `flags` or the list must grow, or `out` must hold the saved regions the views aside
 *  ask. */
export const growthAsked = (resources: DagResources, state: DagRuntimeState) =>
  !!state.grow ||
  !!state.growFlags ||
  state.growHeld > resources.heldSlots ||
  (!state.regionsFull && regionsWanted(resources.swap) > resources.swap.regions)

/** True when no cut may run on the tables now: disposed, lost, or tables to grow — which wait for
 *  the readbacks in flight, then grow (`queueDagGrowth`): no frame cuts on the old ones. The main
 *  view's dispatch (`dispatch.ts`) and a view's aside (`aside.ts`) alike. */
export function tablesHeld(resources: DagResources, state: DagRuntimeState) {
  if (state.disposed || state.dead || state.growing) return true
  if (!growthAsked(resources, state)) return false
  if (!resources.readbacks.held()) queueDagGrowth(resources, state)
  return true
}

/**
 * The row cache now holds `rows` rows (`../../webgpu/pages/prepare/growTables.ts`): the open counts
 * the cut's placements hold follow it, on its readout's growth path, before the next cut. The table
 * is an accelerator — an entry it cannot place leaves its node's count — so it never refuses a row,
 * and it grows only once the row cache did.
 */
export function followRows(resources: DagResources, state: DagRuntimeState, rows: number) {
  if (!resources.heldSlots) return
  const { device, packed } = resources,
    slots = cutHeldSlots(device.limits, packed.live?.pages ?? packed.pageCount, rows)
  if (slots > resources.heldSlots) state.growHeld = Math.max(state.growHeld, slots)
}
