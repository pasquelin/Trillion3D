/**
 * THE CARD RECORDS, KEPT: one record per card the image may draw, written when its root takes its
 * card or its world moves, never per image. Each mesh's cards stand together in one segment of the
 * records — the run its atlas is bound for —, a segment that fills moving to the end at twice its
 * room, and the records packed again once the room segments left behind is half of it: a card
 * placed or taken back writes one or two records, amortized.
 *
 * A record is what the card pass reads of a card (`webgpu/impostor/cardWgsl.ts`): the world's
 * linear part, its translation in two singles — the high word, then the rest — so the shader takes
 * the eye off it in double-single and draws the card at the eye, its inverse, the shape (object
 * radius, frames a side, hemi, the texel depth's logarithm at unit focal length) and the object-space
 * pivot with the world radius. Nothing in it depends on the view.
 */
import { impostorBakedByMesh, invertMatrix4 } from '../../../sdk-core/src/index.ts'

/** Floats of one card record. */
export const CARD_FLOATS = 44

/** A baked mesh's entry, as the cards read it. */
export type BakedCard = NonNullable<ReturnType<ReturnType<typeof impostorBakedByMesh>['get']>>

/** One mesh's cards: its segment of the records, the world each slot draws and the slot of each
 *  world with how many roots hold it, the roots whose switch holds, their bound, and its atlas. */
export type CardSegment<G> = {
  mesh: number
  entry: BakedCard
  start: number
  capacity: number
  count: number
  worlds: ArrayLike<number>[]
  holders: Map<ArrayLike<number>, { slot: number; roots: number }>
  eligible: Int32Array
  eligibleCount: number
  /** The pivot spheres of the roots switched, as one box: grown, emptied with them. */
  box: Float64Array
  /** The mesh's atlas, as the last image that asked it found it. */
  group: G | undefined
  /** Asked in view and found absent: its roots keep their clusters until it lands. */
  gated: boolean
  /** Roots switched this image while the mesh held no atlas: the view decides their bit. */
  pending: number[]
}

export function createCardSlots() {
  return {
    records: new Float32Array(CARD_FLOATS * 16),
    /** Records the segments span, those they left included. */
    used: 0,
    holes: 0,
    /** Slots written since the last upload, once each; every slot when `full`. */
    dirty: new Int32Array(16),
    dirtyCount: 0,
    marked: new Uint8Array(16),
    full: true,
    /** Records written: what a test counts. */
    writes: 0,
  }
}

export type CardSlots = ReturnType<typeof createCardSlots>

const inverse = new Float64Array(16),
  ORIGIN = [0, 0, 0] as const

/** Writes the record of a card of `entry` placed by `world` at world radius `radius` into slot
 *  `slot`. */
export function writeCardRecord(
  slots: CardSlots,
  slot: number,
  world: ArrayLike<number>,
  entry: BakedCard,
  radius: number,
) {
  const out = slots.records,
    at = slot * CARD_FLOATS
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 3; k++) out[at + 4 * c + k] = world[4 * c + k]
    out[at + 4 * c + 3] = 0
  }
  for (let k = 0; k < 3; k++) {
    const high = Math.fround(world[12 + k])
    out[at + 12 + k] = high
    out[at + 16 + k] = world[12 + k] - high
  }
  out[at + 15] = 1
  out[at + 19] = 0
  out.set(invertMatrix4(inverse, world), at + 20)
  out[at + 36] = entry.objectRadius ?? entry.radius
  out[at + 37] = entry.frames
  out[at + 38] = entry.hemi ? 1 : 0
  out[at + 39] = Math.log2((2 * radius) / entry.frameSide)
  const centre = entry.centre ?? ORIGIN
  for (let k = 0; k < 3; k++) out[at + 40 + k] = centre[k]
  out[at + 43] = radius
  slots.writes++
  markDirty(slots, slot)
}

function markDirty(slots: CardSlots, slot: number) {
  if (slots.full) return
  if (slot >= slots.marked.length) {
    const marked = new Uint8Array(Math.max(slot + 1, slots.marked.length * 2))
    marked.set(slots.marked)
    slots.marked = marked
  }
  if (slots.marked[slot]) return
  slots.marked[slot] = 1
  if (slots.dirtyCount === slots.dirty.length) {
    const dirty = new Int32Array(slots.dirty.length * 2)
    dirty.set(slots.dirty)
    slots.dirty = dirty
  }
  slots.dirty[slots.dirtyCount++] = slot
}

/** The slots written are uploaded: the list starts again empty. */
export function uploaded(slots: CardSlots) {
  for (let i = 0; i < slots.dirtyCount; i++) slots.marked[slots.dirty[i]] = 0
  slots.dirtyCount = 0
  slots.full = false
}

/** Room for `records` records, those held kept; the GPU copy is written again whole. */
function hold(slots: CardSlots, records: number) {
  if (slots.records.length >= records * CARD_FLOATS) return
  const next = new Float32Array(Math.max(records * CARD_FLOATS, slots.records.length * 2))
  next.set(slots.records.subarray(0, slots.used * CARD_FLOATS))
  slots.records = next
  slots.full = true
}

/** A free slot at the end of `segment`, which grows to twice its room when full: in place when it
 *  ends the records, else moved to their end; the records packed again once the room left behind
 *  is half of theirs. */
export function slotAtEnd<G>(
  slots: CardSlots,
  segments: Iterable<CardSegment<G>>,
  segment: CardSegment<G>,
) {
  if (segment.count < segment.capacity) return segment.start + segment.count
  const room = Math.max(4, segment.capacity * 2)
  if (segment.start + segment.capacity === slots.used) {
    hold(slots, segment.start + room)
    slots.used = segment.start + room
  } else {
    hold(slots, slots.used + room)
    const from = segment.start * CARD_FLOATS
    slots.records.copyWithin(slots.used * CARD_FLOATS, from, from + segment.count * CARD_FLOATS)
    slots.holes += segment.capacity
    segment.start = slots.used
    slots.used += room
    slots.full = true
  }
  segment.capacity = room
  if (slots.holes * 2 > slots.used && slots.holes > 64) pack(slots, segments)
  return segment.start + segment.count
}

/** Every segment again from the start of the records, in turn, its room kept. */
function pack<G>(slots: CardSlots, segments: Iterable<CardSegment<G>>) {
  const next = new Float32Array(slots.records.length)
  let at = 0
  for (const segment of segments) {
    const from = segment.start * CARD_FLOATS
    next.set(slots.records.subarray(from, from + segment.count * CARD_FLOATS), at * CARD_FLOATS)
    segment.start = at
    at += segment.capacity
  }
  slots.records = next
  slots.used = at
  slots.holes = 0
  slots.full = true
}

/** Slot `local` of `segment` given back: the segment's last card moves into it. */
export function freeSlot<G>(slots: CardSlots, segment: CardSegment<G>, local: number) {
  const last = --segment.count
  if (local !== last) {
    const to = (segment.start + local) * CARD_FLOATS,
      from = (segment.start + last) * CARD_FLOATS
    slots.records.copyWithin(to, from, from + CARD_FLOATS)
    const world = (segment.worlds[local] = segment.worlds[last])
    segment.holders.get(world)!.slot = local
    markDirty(slots, segment.start + local)
  }
  segment.worlds.length = last
}
