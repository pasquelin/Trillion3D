import type { ProbeSlots } from './probeSlots.ts'
import { TABLE_LANES } from './probeSlots.ts'

/** Cells from the eye a never-traced probe is told apart by, a bucket a cell, the farthest bucket the rest. */
const DISTANCE_BUCKETS = 64
/** Priority buckets of a probe already traced: bucket 0 is the probes never traced. */
const PRIORITY_BUCKETS = 16

/** What tracing a probe costs by where it stands (`ProbeCosts`): its map at half the side, at the whole side, at twice it —
 *  rays a side squared, so a quarter, one and four times the whole side's. The frame's budget is `normal` for each probe it
 *  names. */
export const PROBE_COST = { downsampled: 1, normal: 4, supersampled: 16 } as const

/** The squares of the distances, in metres, from the eye: a probe further than `downsampleSq` is traced at half its side, a
 *  probe nearer than `supersampleSq` at twice it (`probeCostOf`). */
export interface ProbeCosts {
  downsampleSq: number
  supersampleSq: number
}

/** The costs a plan has when its caller names none: half the side past 40 metres, never twice it. */
export const DEFAULT_PROBE_COSTS: ProbeCosts = { downsampleSq: 40 * 40, supersampleSq: 0 }

/** The cost of tracing a probe `distanceSq` (squared metres) from the eye. */
export const probeCostOf = (distanceSq: number, costs: ProbeCosts) =>
  distanceSq >= costs.downsampleSq
    ? PROBE_COST.downsampled
    : distanceSq < costs.supersampleSq
      ? PROBE_COST.supersampled
      : PROBE_COST.normal

/** Queues one probe to trace: its slot, its level, its cell, whether it is its first trace, and whether it is traced at half
 *  its side whatever its distance (a first trace the frame's budget has no room for). */
export type ProbeEmit = (
  slot: number,
  level: number,
  x: number,
  y: number,
  z: number,
  fresh: boolean,
  downsampled: boolean,
) => void

/** The sink of a plan nobody asked for. */
const NOWHERE: ProbeEmit = () => undefined

/** Writes one texel of the table: its rank and its four entries. */
export type TableEmit = (texel: number, a: number, b: number, c: number, d: number) => void

/**
 * Where the histogram `counts` (costs) stops being able to give `limit` whole: the first bucket whose probes do not all fit,
 * and how much of its cost fits.
 */
function cutOf(counts: Float64Array, limit: number) {
  let room = limit
  for (let bucket = 0; bucket < counts.length; bucket++) {
    if (counts[bucket] > room) return { bucket, partial: room }
    room -= counts[bucket]
  }
  return { bucket: counts.length, partial: 0 }
}

/** The slots the histogram `counts` takes `limit` of: each slot `eligible` is counted, at its `costOf`, in its `bucketOf`, the cut
 *  falls where the limit is spent, and every slot below it — and, at it, as many as fit what is left — is `send`. */
type Selection = {
  counts: Float64Array
  eligible(slot: number): boolean
  bucketOf(slot: number): number
  costOf(slot: number): number
  send(slot: number): void
}

function pick(capacity: number, limit: number, count: number, selection: Selection) {
  const { counts, eligible, bucketOf, costOf, send } = selection
  counts.fill(0)
  for (let slot = 0; slot < capacity; slot++)
    if (eligible(slot)) counts[bucketOf(slot)] += costOf(slot)
  const { bucket: cut, partial } = cutOf(counts, limit)
  let room = partial,
    sent = 0
  for (let slot = 0; slot < capacity && sent < count; slot++) {
    if (!eligible(slot)) continue
    const bucket = bucketOf(slot),
      cost = costOf(slot)
    if (bucket > cut || (bucket === cut && room < cost)) continue
    if (bucket === cut) room -= cost
    send(slot)
    sent++
  }
  return sent
}

/** The image being planned: what the selections read, set once per call of `probes`. */
type Image = {
  now: number
  eye: Int32Array
  at: ArrayLike<number>
  costs: ProbeCosts
  emit: ProbeEmit
  /** The budget of the frame in cost, and what the probes first traced have taken of it so far. */
  room: number
  spent: number
}

/** The probes never traced, by level then whole cells from the eye; each counts one toward the queue. */
function untracedSelection(
  slots: ProbeSlots,
  levels: number,
  image: Image,
  send: Selection['send'],
) {
  const { owner, cell, tracedAt } = slots
  return {
    counts: new Float64Array(levels * DISTANCE_BUCKETS),
    eligible: (slot: number) => owner[slot] >= 0 && tracedAt[slot] === 0,
    bucketOf(slot: number) {
      const level = slots.levelOf(slot)
      let squared = 0
      for (let axis = 0; axis < 3; axis++)
        squared += (cell[slot * 3 + axis] - image.eye[level * 3 + axis]) ** 2
      return (
        level * DISTANCE_BUCKETS + Math.min(DISTANCE_BUCKETS - 1, Math.floor(Math.sqrt(squared)))
      )
    },
    costOf: () => 1,
    send,
  }
}

/** The probes traced before and still short of their updates, by the log₂ of their age over their level plus one, each at
 *  its cost. */
function tracedSelection(
  slots: ProbeSlots,
  image: Image,
  costOf: (slot: number) => number,
  send: Selection['send'],
) {
  const { owner, tracedAt, traces, settle } = slots
  return {
    counts: new Float64Array(PRIORITY_BUCKETS),
    eligible: (slot: number) =>
      owner[slot] >= 0 && tracedAt[slot] > 0 && tracedAt[slot] < image.now && traces[slot] < settle,
    bucketOf(slot: number) {
      const importance = Math.max(1, image.now - tracedAt[slot]) / (slots.levelOf(slot) + 1)
      return (
        PRIORITY_BUCKETS - 1 - Math.min(PRIORITY_BUCKETS - 2, Math.floor(Math.log2(importance)))
      )
    },
    costOf,
    send,
  }
}

/**
 * THE ORDER PROBES ARE TRACED IN, and the table the GPU reads, per image.
 *
 * Every probe has a cost (`probeCostOf`): by its distance from the eye, a quarter, one or four times a whole map. The budget of a
 * frame is `normal` for each probe it names. A probe never traced holds nothing: it comes before every refresh, the finest
 * level first and the cells nearest the eye first, up to the frame's queue — the first update of a cell is what lets it answer
 * at all —, each at its own cost, and, once the budget has no room left for the cost of those first traced, at a quarter
 * of it whatever their distance. The probes already traced take what the budget leaves after the whole cost of all those never
 * traced, by the priority a light cache gives them: the longer since a probe was traced, over its level plus one — a coarser
 * level changes slower and is worth less of the frame —, the sooner it is traced again, in log₂ buckets, the buckets filled whole
 * from the most important one, the last as far as its probes' costs fit. A probe stops being traced once it took
 * `settledTraces` updates since the lights changed (`restart`).
 */
export function createProbePlan(slots: ProbeSlots, spacings: readonly number[]) {
  const { cell, capacity } = slots
  const lanes = new Float32Array(TABLE_LANES)
  const image: Image = {
    now: 0,
    eye: new Int32Array(0),
    at: [0, 0, 0],
    costs: DEFAULT_PROBE_COSTS,
    emit: NOWHERE,
    room: 0,
    spent: 0,
  }
  const costOf = (slot: number) => {
    const spacing = spacings[slots.levelOf(slot)]
    let squared = 0
    for (let axis = 0; axis < 3; axis++)
      squared += ((cell[slot * 3 + axis] + 0.5) * spacing - image.at[axis]) ** 2
    return probeCostOf(squared, image.costs)
  }
  const send = (slot: number, downsampled: boolean) => {
    const at = slot * 3
    const first = slots.trace(slot, image.now)
    image.emit(slot, slots.levelOf(slot), cell[at], cell[at + 1], cell[at + 2], first, downsampled)
  }
  const sendNew = (slot: number) => {
    const cost = costOf(slot),
      extra = cost - PROBE_COST.downsampled
    send(slot, image.spent + extra > image.room)
    image.spent += extra
  }
  const untraced = untracedSelection(slots, spacings.length, image, sendNew)
  const traced = tracedSelection(slots, image, costOf, (slot) => send(slot, false))
  return {
    /**
     * Queues this image's probes into `probe`, `frame` the image, `at` the cells the eye is in, `eye` its place in metres, a level
     * after the other: those never traced up to `queue`, then the others up to `budget` probes' cost in all, none past `queue`;
     * returns how many.
     */
    probes(
      frame: number,
      at: Int32Array,
      eye: ArrayLike<number>,
      queue: number,
      budget: number,
      probe: ProbeEmit,
      costs: ProbeCosts = DEFAULT_PROBE_COSTS,
    ): number {
      Object.assign(image, { now: frame, eye: at, at: eye, costs, emit: probe })
      image.room = budget * PROBE_COST.normal
      let waiting = 0,
        eligible = 0
      for (let slot = 0; slot < capacity; slot++)
        if (untraced.eligible(slot)) {
          waiting += costOf(slot)
          eligible++
        }
      image.spent = Math.min(queue, eligible) * PROBE_COST.downsampled
      const first = pick(capacity, queue, queue, untraced)
      const left = image.room - waiting
      return first + (left > 0 && queue > first ? pick(capacity, left, queue - first, traced) : 0)
    },
    /** Writes into `table` the texels of the GPU's table that changed, `limit` at most; returns how many. */
    table(limit: number, table: TableEmit): number {
      let sent = 0
      for (; sent < limit; sent++) {
        const texel = slots.takeDirty(lanes)
        if (texel < 0) break
        table(texel, lanes[0], lanes[1], lanes[2], lanes[3])
      }
      return sent
    },
  }
}
