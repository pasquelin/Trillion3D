import { splitDouble } from '../../../../math/src/float/splitDouble.ts'
import { AXIS_DIRECTIONS } from './cardResolution.ts'
import {
  cardIsAllocated,
  cardMipDesc,
  mipOf,
  type Card,
  type MeshCardsInstance,
} from './cardTypes.ts'

/**
 * THE RECORDS THE GPU READS of the cards: for each card and each mesh cards instance a record of
 * words, in the layouts below — the same fields the reference keeps, in a word layout of our own.
 */

/** Floats and words of one buffer of records. */
export interface CardWords {
  readonly f32: Float32Array
  readonly u32: Uint32Array
}

/** The words of a card's record. */
export const CARD_WORDS = 28
/** The words of a mesh cards' record. */
export const MESH_CARDS_WORDS = 24

/** The axes of `card`'s object space, each as the card axis and the sign it lies along, three
 *  bits each, packed X, Y, Z: what takes a vector from the space of the mesh cards to the card's. */
function packObjectAxes(card: Card) {
  let packed = 0
  for (let objectAxis = 0; objectAxis < 3; objectAxis++) {
    for (let k = 0; k < 3; k++) {
      if (card.axes[k] >> 1 !== objectAxis) continue
      const positive = ((card.axes[k] & 1) === 1) !== (k === 0 && card.axisXFlipped)
      packed |= (2 * k + (positive ? 1 : 0)) << (3 * objectAxis)
    }
  }
  return packed
}

/** The page count of mip `resLevel` of `card` as it is told to the GPU — pages along X, pages along
 *  Y shifted by 16 —, and the index of its first page; both 0 for a mip not made. */
function mipRecord(card: Card, resLevel: number) {
  const mip = cardIsAllocated(card) ? mipOf(card, resLevel) : undefined
  return mip && mip.spanSize > 0
    ? ([mip.sizeX | (mip.sizeY << 16), mip.spanOffset] as const)
    : ([0, 0] as const)
}

/**
 * Writes the record of `card` at word `at` of `words`, `CARD_WORDS` words, zero for a card not
 * there (`undefined`). In order:
 *
 * - 0..2 the centre's high part; 3 flags: the width's and the height's bias (bits 0-7 and 8-15), the
 *   direction (16-19), and bit 24 when the law keeps the card and it is in the atlas;
 * - 4..6, 8..10, 12..14 the unit axes X, Y and Z in the world; 7, 11 and 15 the low part of the
 *   centre's X, Y and Z;
 * - 16, 17 the page count and the first page of the coarsest mip in the atlas, 18, 19 those of the
 *   finest (the page counts are `X | Y << 16`);
 * - 20..22 the centre in the space of the mesh cards, 23 its axes packed (`packObjectAxes`);
 * - 24..26 the half sides in that space, by object axis, 27 the mean size of a texel of the
 *   coarsest mip in the world, 100 where the card is not in the atlas.
 */
export function writeCardWords(words: CardWords, at: number, card: Card | undefined) {
  const { f32, u32 } = words
  if (!card) {
    u32.fill(0, at, at + CARD_WORDS)
    return
  }
  const allocated = cardIsAllocated(card)
  const parts = [0, 1, 2].map((k) => splitDouble(card.origin[k]))
  f32[at] = parts[0][0]
  f32[at + 1] = parts[1][0]
  f32[at + 2] = parts[2][0]
  u32[at + 3] =
    (card.resBiasX & 0xff) |
    ((card.resBiasY & 0xff) << 8) |
    ((card.direction & 0xf) << 16) |
    (card.visible && allocated ? 1 << 24 : 0)
  ;[card.axisX, card.axisY, card.axisZ].forEach((axis, k) => {
    f32.set(axis, at + 4 + 4 * k)
    f32[at + 7 + 4 * k] = parts[k][1]
  })
  const [coarseSize, coarseFirst] = allocated ? mipRecord(card, card.minResLevel) : [0, 0]
  const [fineSize, fineFirst] = allocated ? mipRecord(card, card.maxResLevel) : [0, 0]
  u32[at + 16] = coarseSize
  u32[at + 17] = coarseFirst
  u32[at + 18] = fineSize
  u32[at + 19] = fineFirst
  f32[at + 20] = (card.box[0] + card.box[3]) * 0.5
  f32[at + 21] = (card.box[1] + card.box[4]) * 0.5
  f32[at + 22] = (card.box[2] + card.box[5]) * 0.5
  u32[at + 23] = packObjectAxes(card)
  f32[at + 24] = (card.box[3] - card.box[0]) * 0.5
  f32[at + 25] = (card.box[4] - card.box[1]) * 0.5
  f32[at + 26] = (card.box[5] - card.box[2]) * 0.5
  const desc = allocated ? cardMipDesc(card, card.minResLevel) : undefined
  f32[at + 27] = desc
    ? 0.5 * (card.extent[0] / desc.resolutionX + card.extent[1] / desc.resolutionY)
    : 100
}

/**
 * Writes the record of `instance` at word `at` of `words`, `MESH_CARDS_WORDS` words, zero for one
 * not there. In order:
 *
 * - 0..2 the origin's high part, 3 unused;
 * - 4..6, 8..10 and 12..14 the rows of the rotation (`MeshCardsInstance.rotation`), 7, 11 and 15 the
 *   low part of the origin's X, Y and Z;
 * - 16 the index of the first card, 17 the number of cards, with bit 17 set for a mesh mostly
 *   two-sided;
 * - 18..23 the bit masks of the cards of each of the six directions.
 */
export function writeMeshCardsWords(
  words: CardWords,
  at: number,
  instance: MeshCardsInstance | undefined,
) {
  const { f32, u32 } = words
  if (!instance) {
    u32.fill(0, at, at + MESH_CARDS_WORDS)
    return
  }
  const parts = [12, 13, 14].map((k) => splitDouble(instance.localToWorld[k]))
  f32[at] = parts[0][0]
  f32[at + 1] = parts[1][0]
  f32[at + 2] = parts[2][0]
  f32[at + 3] = 0
  for (let row = 0; row < 3; row++) {
    f32.set(instance.rotation.subarray(row * 3, row * 3 + 3), at + 4 + 4 * row)
    f32[at + 7 + 4 * row] = parts[row][1]
  }
  u32[at + 16] = instance.firstCard
  u32[at + 17] = (instance.numCards & 0xffff) | (instance.mostlyTwoSided ? 0x20000 : 0)
  for (let direction = 0; direction < AXIS_DIRECTIONS; direction++)
    u32[at + 18 + direction] = instance.lookup[direction]
}
