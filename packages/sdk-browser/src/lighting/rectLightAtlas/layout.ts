/**
 * THE RECTANGLE LIGHTS' ATLAS LAYOUT: the pure bookkeeping of where each picture sits in the one square atlas, in texels — rectangles,
 * mip arithmetic, the picture's resolution as the atlas wants it. No device is touched here; `pack.ts` finds the places and
 * `manager.ts` keeps the slots.
 */

/** A point or a size, in texels. */
export interface Point {
  x: number
  y: number
}

/** A rectangle of the atlas: its origin (`INVALID_ORIGIN` while it has no place) and its size, in texels. */
export interface AtlasRect {
  origin: Point
  size: Point
}

/** The origin of a rectangle that has no place in the atlas yet. */
export const INVALID_ORIGIN = -1
/** The index of a slot that does not exist. */
export const INVALID_SLOT = 0xffffffff
/** The mip level a rectangle light with no picture carries: past every level, so that no read is made. */
export const INVALID_MIP_LEVEL = 32

export const newRect = (): AtlasRect => ({
  origin: { x: INVALID_ORIGIN, y: INVALID_ORIGIN },
  size: { x: 0, y: 0 },
})
export const copyRect = (r: AtlasRect): AtlasRect => ({
  origin: { ...r.origin },
  size: { ...r.size },
})
export const hasPlace = (r: AtlasRect) =>
  r.origin.x !== INVALID_ORIGIN || r.origin.y !== INVALID_ORIGIN

/** A horizon line of the skyline packing, and the line it extends to under the lines that stand lower beside it. */
export interface Horizon {
  line: AtlasRect
  extended: AtlasRect
}

/** The atlas as packed: its size, how many mip levels the pictures are read smaller than their own, the horizon lines and the free rectangles
 *  (the holes the deleted slots left). */
export interface AtlasLayout {
  width: number
  height: number
  sourceMipBias: number
  horizons: Horizon[]
  freeRects: AtlasRect[]
}

/** The side a new atlas starts at. */
export const FIRST_ATLAS_SIDE = 256

export const newLayout = (width = FIRST_ATLAS_SIDE, height = width): AtlasLayout => ({
  width,
  height,
  sourceMipBias: 0,
  horizons: [],
  freeRects: [],
})

const divideAndRoundUp = (value: number, by: number) => Math.ceil(value / by)

/** The size `size` has at mip level `mip`. */
export const toMip = (size: Point, mip: number): Point => {
  const div = 2 ** mip
  return { x: divideAndRoundUp(size.x, div), y: divideAndRoundUp(size.y, div) }
}

/** The highest mip level a slot of `size` is read at: the levels its short side holds, less the last. */
export const slotMaxMipLevel = (size: Point) => {
  const max = Math.floor(Math.log2(Math.max(1, Math.min(size.x, size.y))))
  return max > 0 ? max - 1 : 0
}

/** `rect` made a whole number of texels at its coarsest mip level, so that a bilinear read does not leak into the slot beside it. Rounding up can
 *  raise that level (a 63 by 100 slot becomes 64 by 112, whose short side holds one level more), so it is done again until the level holds. */
export function alignSlotSize(rect: AtlasRect) {
  for (;;) {
    const max = slotMaxMipLevel(rect.size)
    const atMax = toMip(rect.size, max)
    const size = { x: atMax.x * 2 ** max, y: atMax.y * 2 ** max }
    const same = size.x === rect.size.x && size.y === rect.size.y
    rect.size = size
    if (same) return
  }
}

/** The mip levels of an atlas of `size`: the levels its short side holds, less the last (a whole number of the float log). */
export const atlasMipCount = (size: Point) => Math.floor(Math.log2(Math.min(size.x, size.y)))

/** The picture's size, in texels, as the atlas wants it: the share of the picture the light shows, its proportions held to `maxRatio` by stretching the short side. */
export function sourceResolution(
  image: { readonly width: number; readonly height: number } | undefined,
  scaleOffset: readonly number[],
  maxRatio: number,
): Point {
  if (!image) return { x: 1, y: 1 }
  const sx = scaleOffset[0] * image.width
  const sy = scaleOffset[1] * image.height
  const ratioYX = sy / sx
  const ratioXY = sx / sy
  // A share that rounds to no texel is held to one.
  const out = { x: Math.max(1, Math.trunc(sx)), y: Math.max(1, Math.trunc(sy)) }
  const threshold = Math.min(16, Math.max(1, maxRatio))
  if (ratioYX > threshold) out.x = Math.trunc(out.x * (ratioYX / threshold))
  else if (ratioXY > threshold) out.y = Math.trunc(out.y * (ratioXY / threshold))
  return out
}

/** A picture a slot holds: anything with a size; the host's image (`HostImage`). */
export interface SourceImage {
  readonly width: number
  readonly height: number
}

/** One picture's place in the atlas. A slot with no `source` is free. */
export interface AtlasSlot {
  id: number
  rect: AtlasRect
  /** The share of the picture shown (`x`, `y`) and where it starts (`z`, `w`). */
  scaleOffset: readonly [number, number, number, number]
  source: SourceImage | undefined
  /** The size of the picture the slot was last sized for: a picture that streams in larger moves it. */
  cachedSize: Point
  refs: number
  forceRefresh: boolean
}

export const freeSlot = (): AtlasSlot => ({
  id: INVALID_SLOT,
  rect: newRect(),
  scaleOffset: [1, 1, 0, 0],
  source: undefined,
  cachedSize: { x: 0, y: 0 },
  refs: 0,
  forceRefresh: false,
})

/** What moves a slot from the old atlas to the new one when the layout is made again. */
export interface CopySlot {
  id: number
  srcOrigin: Point
  dstOrigin: Point
  size: Point
  source: SourceImage
}
