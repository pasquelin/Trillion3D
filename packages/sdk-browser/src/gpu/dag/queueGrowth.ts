import { validationScope } from '../core/errorScope.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { cameraCutBuffers, makeDagBuffer } from './bufferTable.ts'
import type { FlagShape } from './flagSections.ts'
import { JOURNAL_SECTION, LAST_USE_SECTION, flagSectionPlace } from './splitFlags.ts'
import { createDagPipeline } from './pipeline.ts'
import { cutHeldSlots, growDagList, heldOpenAt, madeWithin, rankGroups } from './listCap.ts'
import { regionsWanted } from './swap.ts'
import { recutMain, recutView, type DagRuntimeState } from './runtimeState.ts'
import { LIST_DROPPED, QUEUE_DROPPED } from './shader/viewsWgsl.ts'
import type { CutTablesAt } from './uniforms.ts'
import type { createDagResources } from './resources.ts'
type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>

/**
 * THE QUEUES AND LISTS A CUT GROWS TO. A cut's descent queues and its candidate and live lists are
 * sized for a view's reach when it is made (`layout.ts`, `QUEUE_ENTRIES_START`), never for the
 * world. A cut that passes one drops the work past it and says which (`shader/viewsWgsl.ts`,
 * `QUEUE_DROPPED`, `LIST_DROPPED`): it is not drawn (`shader/commitWgsl.ts`) — the frame draws the
 * last cut that ran whole — and never adopted, and what was full doubles here, the next cut cutting
 * again on it. A queue never holds more than every entry, a list more than every page, nor a
 * section more than one binding: past that, `undefined`, and the view coarsens instead
 * (`coarsening.ts`), as it does past the readout's list (`listCap.ts`).
 */
export function grownFlagShape(
  limits: Parameters<typeof storageBufferCap>[0],
  bounds: { entryCount: number; pageCount: number },
  shape: FlagShape,
  dropped: number,
): FlagShape | undefined {
  const words = storageBufferCap(limits) / 4
  // A queue entry is two words; the live list's, the widest list, three (`shader/liveWgsl.ts`).
  const queueWords =
      dropped & QUEUE_DROPPED
        ? Math.min(
            2 * Math.max(1, bounds.entryCount),
            2 * shape.queueWords,
            2 * Math.floor(words / 2),
          )
        : shape.queueWords,
    candCap =
      dropped & LIST_DROPPED
        ? Math.min(Math.max(1, bounds.pageCount), 2 * shape.candCap, Math.floor(words / 3))
        : shape.candCap
  if (queueWords <= shape.queueWords && candCap <= shape.candCap) return undefined
  return { ...shape, queueWords, candCap }
}

/** The wider of two shapes asked, field by field: two views that dropped work ask both. */
export const widerFlagShape = (a: FlagShape | undefined, b: FlagShape): FlagShape =>
  a
    ? {
        queueWords: Math.max(a.queueWords, b.queueWords),
        candCap: Math.max(a.candCap, b.candCap),
        keyCount: b.keyCount,
      }
    : b

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
 * Gives the cut a `flags` of `shape`, between two frames and with no readback in flight: its parts
 * made under an out-of-memory scope, the kernels compiled again when the parts start at other
 * sections (`split.ts`), the drawn log and the last uses carried over, the bind groups made again
 * and the old parts destroyed. A device that refuses keeps the old `flags` whole and says `false`:
 * the next cut that drops work coarsens instead.
 */
async function growDagFlags(resources: DagResources, shape: FlagShape, disposed: () => boolean) {
  const { device, packed } = resources
  const sized = { ...packed, queueEntries: shape.queueWords / 2, candCount: shape.candCap }
  const cut = cameraCutBuffers(sized, device.limits)
  const made: GPUBuffer[] = []
  const make = madeWithin(resources, resources.flagParts, made)
  let parts: GPUBuffer[] | undefined
  try {
    const { value, error } = await validationScope(
      device,
      () => cut.parts.flags.map((row) => makeDagBuffer(make, row)),
      'out-of-memory',
    )
    if (!error) parts = value
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  const group = parts && {
    ...resources.group,
    flags: parts[0],
    parts: { ...resources.group.parts, flags: parts.slice(1) },
  }
  const same = cut.split.flagCuts.join() === resources.split.flagCuts.join()
  const compiled =
    group && !same ? await createDagPipeline(device, group, resources.frames, cut.split) : undefined
  if (!parts || !group || (compiled && !compiled.value) || disposed()) {
    for (const buffer of made) buffer.destroy()
    return false
  }
  carryFlags(resources, parts, cut.split.flagCuts, shape)
  const old = resources.flagParts
  Object.assign(resources, compiled?.value, {
    flags: parts[0],
    flagParts: parts,
    split: cut.split,
    flagShape: shape,
    group,
  })
  resources.buffers.push(...made)
  if (!compiled) resources.ranges = resources.frames.bindGroups(resources.layout, group)
  resources.rankGroups = rankGroups(resources)
  for (const buffer of old) {
    resources.buffers.splice(resources.buffers.indexOf(buffer), 1)
    buffer.destroy()
  }
  return true
}

/** The sections a cut keeps across cuts (`JOURNAL_SECTION`, `LAST_USE_SECTION`) copied from
 *  `resources`' flags into `parts`, cut at `cuts` for `shape`, each at its new place. */
function carryFlags(
  resources: DagResources,
  parts: GPUBuffer[],
  cuts: readonly number[],
  shape: FlagShape,
) {
  const from = resources.flagShape,
    encoder = resources.device.createCommandEncoder()
  const words = { [JOURNAL_SECTION]: from.candCap, [LAST_USE_SECTION]: from.keyCount }
  for (const s of [JOURNAL_SECTION, LAST_USE_SECTION]) {
    const a = flagSectionPlace(resources.split.flagCuts, from, s),
      b = flagSectionPlace(cuts, shape, s)
    const source = resources.flagParts[a.part]
    encoder.copyBufferToBuffer(source, a.word * 4, parts[b.part], b.word * 4, words[s] * 4)
  }
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
const growthAsked = (resources: DagResources, state: DagRuntimeState) =>
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
  if (!state.mapped.includes(true)) queueDagGrowth(resources, state)
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
