import type { BounceCascades } from './cascades.ts'
import { BOUNCE_SETTINGS } from './contracts.ts'
import { createProbePlan, type ProbeCosts, type ProbeEmit, type TableEmit } from './probePlan.ts'
import { createProbeSlots, type ProbeSlots } from './probeSlots.ts'

/**
 * THE POOL OF PROBES a view needs, sparse: of the cells of the levels around the eye — 48³ a
 * level, four levels —, only the cells the image reads hold a probe, from a pool of a fixed size.
 *
 * Each image marks the cells it reads (`mark`: the eight probes around the surface points the
 * screen shows): a marked cell with no probe takes one from the pool, a marked cell keeps its
 * own. A probe is given back when its cell leaves its level — the level slid under the eye:
 * `slide` — or when no mark read it for `probeKeptMarks` marks (`expire`), the cells it kept in
 * between being the ones a turn of the head shows again. A pool with none left refuses a mark: the
 * cell goes unanswered, and the next level or the sky light answers for it. What is traced and in
 * what order is `probes`' (`probePlan.ts`); what the GPU is told, the table of its entries.
 *
 * Marks come from the GPU a few images late (`lighting/bounce/marks.ts`): `frame` is the image
 * they were made in, the clock every age here is in; an image that marks nothing advances no age.
 */
export interface ProbePool {
  /** Probes the pool holds at most. */
  readonly capacity: number
  /** Probes alive. */
  readonly live: number
  /** Probes alive that were never traced: the light the image reads is filled when none is. */
  readonly unfilled: number
  /** Probes alive still short of their updates. */
  readonly refreshing: number
  /** Marks refused for want of a probe in the pool, since it was made. */
  readonly refused: number
  /** Whether the pool still has work: a probe to trace or a texel of the table to tell the GPU. */
  readonly working: boolean
  /** The cell `x, y, z` of `level` was read at `frame`: it holds a probe from now on. */
  mark(level: number, x: number, y: number, z: number, frame: number): void
  /** The levels slid: the probes whose cell left its level are given back. */
  slide(): void
  /** The probes no mark read for `probeKeptMarks` images before `frame` are given back. */
  expire(frame: number): void
  /** The lights changed: every probe is traced again. */
  restart(): void
  /**
   * Queues the probes of image `frame` for an eye at `viewpoint` (`createProbePlan`): up to `queue`
   * probes never traced, then the others, `budget` probes' cost in all (`costs`: by distance from the eye, a quarter,
   * one or four times a probe's whole cost); returns how many.
   */
  probes(
    frame: number,
    viewpoint: ArrayLike<number>,
    queue: number,
    budget: number,
    emit: ProbeEmit,
    costs?: ProbeCosts,
  ): number
  /** The texels of the GPU's table that changed, `limit` at most, written through `emit`; how many. */
  table(limit: number, emit: TableEmit): number
}

/** The cell `x, y, z` of `level` holds a probe, read at `frame`: the one it held, or a new one. */
function mark(
  slots: ProbeSlots,
  cascades: BounceCascades,
  level: number,
  x: number,
  y: number,
  z: number,
  frame: number,
) {
  if (!cascades.holds(level, x, y, z)) return
  const entry = slots.entryAt(level, x, y, z)
  const slot = slots.held[entry] - 1
  if (slot >= 0) {
    const at = slot * 3
    if (slots.cell[at] === x && slots.cell[at + 1] === y && slots.cell[at + 2] === z) {
      slots.usedAt[slot] = frame
      return
    }
    // The cell this entry names was another one, which left the level: its probe goes.
    slots.release(slot)
  }
  slots.allocate(entry, x, y, z, frame)
}

/** Gives back every probe `gone` says goes, among those alive. */
function giveBack(slots: ProbeSlots, gone: (slot: number) => boolean) {
  for (let slot = 0; slot < slots.capacity; slot++)
    if (slots.owner[slot] >= 0 && gone(slot)) slots.release(slot)
}

/** The probes of the levels, and which cells hold one. */
export function createProbePool(cascades: BounceCascades): ProbePool {
  const slots = createProbeSlots(cascades)
  const levels = cascades.levels.length
  const plan = createProbePlan(
    slots,
    cascades.levels.map((level) => level.spacing),
  )
  const kept = BOUNCE_SETTINGS.probeKeptMarks
  const eye = new Int32Array(levels * 3)
  const { tally, cell, usedAt } = slots
  /** The image `expire` judges the ages against, and the two reasons a probe goes. */
  let now = 0
  const outside = (slot: number) => {
    const at = slot * 3
    return !cascades.holds(slots.levelOf(slot), cell[at], cell[at + 1], cell[at + 2])
  }
  const unread = (slot: number) => now - usedAt[slot] >= kept
  return {
    capacity: slots.capacity,
    get live() {
      return tally.live
    },
    get unfilled() {
      return tally.unfilled
    },
    get refreshing() {
      return tally.refreshing
    },
    get refused() {
      return tally.refused
    },
    get working() {
      return tally.unfilled > 0 || tally.refreshing > 0 || slots.waiting > 0
    },
    mark: (level, x, y, z, frame) => mark(slots, cascades, level, x, y, z, frame),
    slide: () => giveBack(slots, outside),
    expire(frame) {
      now = frame
      giveBack(slots, unread)
    },
    restart: slots.restart,
    probes(frame, viewpoint, queue, budget, emit, costs) {
      for (let level = 0; level < levels; level++)
        for (let axis = 0; axis < 3; axis++)
          eye[level * 3 + axis] = Math.floor(viewpoint[axis] / cascades.levels[level].spacing)
      return plan.probes(frame, eye, viewpoint, queue, budget, emit, costs)
    },
    table: plan.table,
  }
}

export type { ProbeEmit, TableEmit }
