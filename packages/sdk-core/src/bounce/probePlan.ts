import type { ProbeSlots } from './probeSlots.ts'
import { TABLE_LANES } from './probeSlots.ts'

/** Cells from the eye a never-traced probe is told apart by, a bucket a cell, the farthest bucket the rest. */
const DISTANCE_BUCKETS = 64
/** Priority buckets of a probe already traced: bucket 0 is the probes never traced. */
const PRIORITY_BUCKETS = 16

/** Queues one probe to trace: its slot, its level, its cell, whether it is its first trace. */
export type ProbeEmit = (
  slot: number,
  level: number,
  x: number,
  y: number,
  z: number,
  fresh: boolean,
) => void

/** The sink of a plan nobody asked for. */
const NOWHERE: ProbeEmit = () => undefined

/** Writes one texel of the table: its rank and its four entries. */
export type TableEmit = (texel: number, a: number, b: number, c: number, d: number) => void

/**
 * Where the histogram `counts` stops being able to give `limit` probes whole: the first bucket
 * whose probes do not all fit, and how many of that one fit.
 */
function cutOf(counts: Uint32Array, limit: number) {
  let room = limit
  for (let bucket = 0; bucket < counts.length; bucket++) {
    if (counts[bucket] > room) return { bucket, partial: room }
    room -= counts[bucket]
  }
  return { bucket: counts.length, partial: 0 }
}

/** The slots the histogram `counts` takes `limit` of: each slot `eligible` is counted in its `bucketOf`, the cut
 *  falls where the limit is spent, and every slot below it — and as many at it as are left — is `send`. */
type Selection = {
  counts: Uint32Array
  eligible(slot: number): boolean
  bucketOf(slot: number): number
  send(slot: number): void
}

function pick(capacity: number, limit: number, { counts, eligible, bucketOf, send }: Selection) {
  counts.fill(0)
  for (let slot = 0; slot < capacity; slot++) if (eligible(slot)) counts[bucketOf(slot)]++
  const { bucket: cut, partial } = cutOf(counts, limit)
  let room = partial,
    sent = 0
  for (let slot = 0; slot < capacity; slot++) {
    if (!eligible(slot)) continue
    const bucket = bucketOf(slot)
    if (bucket > cut || (bucket === cut && room-- <= 0)) continue
    send(slot)
    sent++
  }
  return sent
}

/** The image being planned: what the selections read, set once per call of `probes`. */
type Image = { now: number; eye: Int32Array; emit: ProbeEmit }

/** The probes never traced, by level then whole cells from the eye. */
function untracedSelection(
  slots: ProbeSlots,
  levels: number,
  image: Image,
  send: Selection['send'],
) {
  const { owner, cell, tracedAt } = slots
  return {
    counts: new Uint32Array(levels * DISTANCE_BUCKETS),
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
    send,
  }
}

/** The probes traced before and still short of their updates, by the log₂ of their age over their level plus one. */
function tracedSelection(slots: ProbeSlots, image: Image, send: Selection['send']) {
  const { owner, tracedAt, traces, settle } = slots
  return {
    counts: new Uint32Array(PRIORITY_BUCKETS),
    eligible: (slot: number) =>
      owner[slot] >= 0 && tracedAt[slot] > 0 && tracedAt[slot] < image.now && traces[slot] < settle,
    bucketOf(slot: number) {
      const importance = Math.max(1, image.now - tracedAt[slot]) / (slots.levelOf(slot) + 1)
      return (
        PRIORITY_BUCKETS - 1 - Math.min(PRIORITY_BUCKETS - 2, Math.floor(Math.log2(importance)))
      )
    },
    send,
  }
}

/**
 * THE ORDER PROBES ARE TRACED IN, and the table the GPU reads, per image.
 *
 * A probe never traced holds nothing: it comes before every refresh, whatever the budget, the finest
 * level first and the cells nearest the eye first, up to the frame's queue — the first update of a
 * cell is what lets it answer at all. The probes already traced take what the budget leaves, by the
 * priority a light cache gives them: the longer since a probe was traced, over its level plus one —
 * a coarser level changes slower and is worth less of the frame —, the sooner it is traced again, in
 * log₂ buckets, the buckets filled whole from the most important one, the last partly. A probe
 * stops being traced once it took `settledTraces` updates since the lights changed (`restart`).
 */
export function createProbePlan(slots: ProbeSlots, levels: number) {
  const { cell, capacity } = slots
  const lanes = new Float32Array(TABLE_LANES)
  const image: Image = { now: 0, eye: new Int32Array(0), emit: NOWHERE }
  const send = (slot: number) => {
    const at = slot * 3
    const first = slots.trace(slot, image.now)
    image.emit(slot, slots.levelOf(slot), cell[at], cell[at + 1], cell[at + 2], first)
  }
  const untraced = untracedSelection(slots, levels, image, send)
  const traced = tracedSelection(slots, image, send)
  return {
    /**
     * Queues this image's probes into `probe`, `frame` the image, `at` the cells the eye is in, a level
     * after the other: those never traced up to `queue`, then the others up to `budget` in all, none
     * past `queue`; returns how many.
     */
    probes(frame: number, at: Int32Array, queue: number, budget: number, probe: ProbeEmit): number {
      image.now = frame
      image.eye = at
      image.emit = probe
      const first = pick(capacity, queue, untraced)
      const want = Math.min(queue, budget) - first
      return first + (want > 0 ? pick(capacity, want, traced) : 0)
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
