import { MIN_RES_LEVEL, RES_LEVELS, mipDesc, mipTexels } from './cardResolution.ts'

/**
 * THE CARDS OF A SCENE: the cards each mesh carries, put where a placement of the mesh stands.
 *
 * A mesh carries up to 32 cards, flat boxes along its faces, each looking along one of the six
 * axis directions of the mesh's object space (`MeshCards`, built by the compiler). A placement of
 * the mesh puts them in the world: a MESH CARDS INSTANCE holds the placement's matrix and the
 * cards it kept, a CARD its box in the world — where the card's surface is captured from — and in
 * the space of the mesh cards, the object space scaled by the placement, where the eye's distance
 * to it is measured. A card also holds what the atlas holds of it: its mips (`SurfaceMip`), one for
 * each resolution level, as runs of pages of the page table.
 *
 * Lengths are in centimetres, the unit of the global distance field's scene; a placement's matrix
 * and a mesh's boxes are in metres, as the field's are, and are scaled once, here.
 */

/** A vector of three numbers. */
export type Vec3 = readonly [number, number, number]

export type { MeshCard, MeshCards } from '../meshCardsFile.ts'

/** What one level of a card holds of the page table: a run of its pages. */
export interface SurfaceMip {
  /** Whether its pages stay in the atlas as long as the card is wanted. */
  locked: boolean
  /** The pages along each axis. */
  sizeX: number
  sizeY: number
  /** The level of each axis (`MipDesc`). */
  resLevelX: number
  resLevelY: number
  /** The pages of the run, 0 while the mip is not made; and the page table index of the first. */
  spanSize: number
  spanOffset: number
}

/** A card placed in the world, and what the atlas holds of it. */
export interface Card {
  /** Its place among the cards of the mesh, and among those the placement kept. */
  readonly indexInMesh: number
  readonly indexInMeshCards: number
  /** The face it looks at: 0 to 5. */
  readonly direction: number
  /** The direction each of its axes points along in the object space, from 0 to 5. */
  readonly axes: readonly [number, number, number]
  /** Its box in the object space, centimetres. */
  readonly localOrigin: Vec3
  readonly localExtent: Vec3
  /** The levels the width and the height lie below the card's level: its proportion, fixed when the
   *  card was made. */
  resBiasX: number
  resBiasY: number
  /** What cards that may copy one another have in common: the mesh, its materials, the face and the
   *  proportion; -1 for a card that copies none. */
  sharingId: number
  /** The index of its mesh cards. */
  meshCards: number
  /** Whether the placement turned the card's width round: the world axes keep the right-handed
   *  frame, so the copy of a card that is the mirror of this one is read mirrored. */
  axisXFlipped: boolean
  /** Its box in the world: the centre, the unit axes and the half sides. */
  readonly origin: Float64Array
  readonly axisX: Float64Array
  readonly axisY: Float64Array
  readonly axisZ: Float64Array
  readonly extent: Float64Array
  /** Its box in the space of its mesh cards: `minX, minY, minZ, maxX, maxY, maxZ`. */
  readonly box: Float64Array
  /** The greater half side of the face, in that space. */
  maxExtent: number
  /** The mip of each level, from the coarsest (index 0 is level 3). */
  readonly mips: SurfaceMip[]
  /** The coarsest and the finest level with a mip made: the card is in the atlas when the first is
   *  not over the second. */
  minResLevel: number
  maxResLevel: number
  /** Its place in the list of cards that copy one another, -1 if it is in none. */
  sharingIndex: number
  /** The level the resolution law asked last, and the one asked when the coarsest mip was last
   *  made. */
  desiredLockedResLevel: number
  desiredOnLastAlloc: number
  /** Whether the law keeps the card. */
  visible: boolean
}

/** The cards one placement kept, and where it puts them. */
export interface MeshCardsInstance {
  /** The placement it belongs to. */
  readonly placement: number
  /** The index of its first card, and how many it has: its cards are a run. */
  firstCard: number
  readonly numCards: number
  /** The placement's matrix, by column, centimetres. */
  readonly localToWorld: Float64Array
  /** The scale of each of its axes. */
  readonly scale: Float64Array
  /** Row k is the unit vector of the k-th axis of the object space in the world: a world vector
   *  taken to the object space by the dot product of each row with it. */
  readonly rotation: Float64Array
  /** A factor on the resolution of its cards. */
  readonly resolutionScale: number
  readonly mostlyTwoSided: boolean
  readonly emissive: boolean
  /** For each direction, the bit mask of its cards: bit `i` is its i-th card. */
  readonly lookup: Uint32Array
}

/** The six directions, by index: a unit along an axis. */
const DIRECTIONS: readonly Vec3[] = [
  [-1, 0, 0],
  [1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
]

/** The index of the direction a unit axis points along, -1 if it is none of the six. */
export function directionIndex(axis: Vec3) {
  const [x, y, z] = axis
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z)
  if (ax === 1 && ay === 0 && az === 0) return x > 0 ? 1 : 0
  if (ay === 1 && ax === 0 && az === 0) return y > 0 ? 3 : 2
  if (az === 1 && ax === 0 && ay === 0) return z > 0 ? 5 : 4
  return -1
}

/** The unit vector of direction `index`. */
export const directionVector = (index: number): Vec3 => DIRECTIONS[index]

/** Whether `card` is in the atlas: it has a mip made. */
export const cardIsAllocated = (card: Card) => card.minResLevel <= card.maxResLevel

/** The mip of `card` at `resLevel`, from 3 to 11. */
export const mipOf = (card: Card, resLevel: number) => card.mips[resLevel - MIN_RES_LEVEL]

/** Sets the coarsest and the finest level of `card` from the mips made. */
export function updateLevelRange(card: Card) {
  card.minResLevel = 255
  card.maxResLevel = 0
  for (let at = 0; at < RES_LEVELS; at++) {
    if (card.mips[at].spanSize === 0) continue
    card.minResLevel = Math.min(card.minResLevel, at + MIN_RES_LEVEL)
    card.maxResLevel = Math.max(card.maxResLevel, at + MIN_RES_LEVEL)
  }
}

/** The mip of `card` at `resLevel`, as the description of its levels. */
export const cardMipDesc = (card: Card, resLevel: number) =>
  mipDesc(resLevel, card.resBiasX, card.resBiasY)

/**
 * Tells `card` the level the law asks of it, `0` for none; the change of the texels the card would
 * take in the atlas at the level it is asked, for the count of the texels wanted.
 */
export function setDesiredLevel(card: Card, level: number) {
  const before = card.desiredLockedResLevel
  if (before === level) return 0
  card.desiredLockedResLevel = level
  let delta = 0
  if (before > 0) delta -= mipTexels(cardMipDesc(card, before))
  if (level > 0) delta += mipTexels(cardMipDesc(card, level))
  return delta
}
