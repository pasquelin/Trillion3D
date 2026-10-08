/**
 * THE CARD RECORDS, KEPT: one record per card the image may draw, written when its root takes its
 * card or its world moves, never per image. Each mesh's cards stand together in one segment of the
 * records — the run its atlas is bound for —, a segment that fills moving to the end at twice its
 * room, and the records packed again once the room segments left behind is half of it: a card
 * placed or taken back writes one or two records, amortized.
 *
 * A record is what the card pass reads of a card (`webgpu/impostor/cardWgsl.ts`): the world's
 * linear part, its translation in two singles — the high word, then the rest (`writeSplitDouble`) —
 * so the shader takes the eye off it in double-single and draws the card at the eye, the linear
 * part's inverse, the shape (object radius, frames a side, hemi, the texel depth's logarithm at unit
 * focal length) and the object-space pivot with the world radius. Nothing in it depends on the view;
 * a world moved without turning or scaling rewrites its translation alone.
 */
import { invertMatrix4 } from '../../../sdk-core/src/index.ts'
import type { BakedEntry } from '../../../sdk-core/src/impostor/switchTable.ts'
import { writeSplitDouble } from '../../../math/src/float/splitDouble.ts'
import type { DenseKeySet } from '../webgpu/cut/denseKeys.ts'
import { core } from './borrowed.ts'
import { resized } from '../../../math/src/sequence/resized.ts'
import { sameLinearPartFloat32 } from '../../../math/src/matrix/matrixElements.ts'

/** Floats of one card record. */
export const CARD_FLOATS = 44

/** One card: its slot in its segment, the world it draws — the one of every root holding it —,
 *  and how many roots hold it. */
export type CardHolder = { slot: number; world: ArrayLike<number>; roots: number }

/** One mesh's cards: its segment of the records, the card of each slot and each world's card —
 *  two primitives of one placement are one card —, the roots whose switch holds and their bound,
 *  and its atlas. */
export type CardSegment<G> = {
  mesh: number
  entry: BakedEntry
  start: number
  capacity: number
  count: number
  cards: CardHolder[]
  holders: Map<ArrayLike<number>, CardHolder>
  eligible: DenseKeySet
  /** The pivot spheres of the roots switched, as one box; `stale` once one leaves or moves. */
  box: Float64Array
  stale: boolean
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
    /** Slots written since the last upload, once each; every slot when `full` — after a pack, which
     *  moves them all. */
    dirty: core.createMovedWorlds(),
    full: true,
    /** Records written: what a test counts. */
    writes: 0,
  }
}

export type CardSlots = ReturnType<typeof createCardSlots>

const inverse = new Float64Array(16),
  ORIGIN = [0, 0, 0] as const

/** Writes the record of a card of `entry` placed by `world` at world radius `radius` into slot
 *  `slot`; `moved`, the card's record already there, its world alone moved. */
export function writeCardRecord(
  slots: CardSlots,
  slot: number,
  world: ArrayLike<number>,
  entry: BakedEntry,
  radius: number,
  moved = false,
) {
  const out = slots.records,
    at = slot * CARD_FLOATS
  for (let k = 0; k < 3; k++) writeSplitDouble(out, at + 12 + k, at + 16 + k, world[12 + k])
  slots.writes++
  markDirty(slots, slot)
  // A world moved without turning or scaling keeps its inverse and its shape.
  if (moved && out[at + 43] === Math.fround(radius) && sameLinearPartFloat32(out, world, at)) return
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k < 3; k++) out[at + 4 * c + k] = world[4 * c + k]
    out[at + 4 * c + 3] = 0
  }
  out[at + 15] = 1
  out[at + 19] = 0
  // The linear part's inverse alone: the shader takes the eye off the translation itself.
  invertMatrix4(inverse, world)
  inverse[12] = inverse[13] = inverse[14] = 0
  out.set(inverse, at + 20)
  out[at + 36] = entry.objectRadius ?? entry.radius
  out[at + 37] = entry.frames
  out[at + 38] = entry.hemi ? 1 : 0
  out[at + 39] = Math.log2((2 * radius) / entry.frameSide)
  const centre = entry.centre ?? ORIGIN
  for (let k = 0; k < 3; k++) out[at + 40 + k] = centre[k]
  out[at + 43] = radius
}

function markDirty(slots: CardSlots, slot: number) {
  if (!slots.full) slots.dirty.listed.add(slot)
}

/** The slots written are uploaded: the list starts again empty. */
export function uploaded(slots: CardSlots) {
  slots.dirty.listed.clear()
  slots.full = false
}

/** Room for `records` records, those held kept where they are: the GPU copy keeps them too (a
 *  buffer too small for them is made again and written whole, `uploadedTo`). */
function hold(slots: CardSlots, records: number) {
  slots.records = resized(slots.records, records * CARD_FLOATS)
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
    // Its records alone moved: they are written, nothing else.
    for (let k = 0; k < segment.count; k++) markDirty(slots, segment.start + k)
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

/** Card `card` of `segment` given back: the segment's last card moves into its slot. */
export function freeSlot<G>(slots: CardSlots, segment: CardSegment<G>, card: CardHolder) {
  const last = --segment.count,
    local = card.slot
  if (local !== last) {
    const to = (segment.start + local) * CARD_FLOATS,
      from = (segment.start + last) * CARD_FLOATS
    slots.records.copyWithin(to, from, from + CARD_FLOATS)
    const moved = (segment.cards[local] = segment.cards[last])
    moved.slot = local
    markDirty(slots, segment.start + local)
  }
  segment.cards.length = last
}
