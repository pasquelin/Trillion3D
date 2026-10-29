import type { AtlasRect, AtlasSlot, CopySlot, Point } from './layout.ts'
import { toMip } from './layout.ts'

/** Words of a slot in the buffers the passes read: its origin and its size, four whole numbers. */
export const SLOT_WORDS = 4
/** Bytes of the pass's figures (`PassFigures`, `passWgsl.ts`). */
export const FIGURE_BYTES = 32

const rectAt = (origin: Point, size: Point, mip: number): AtlasRect => ({
  origin: toMip(origin, mip),
  size: toMip(size, mip),
})

/** Whether a slot of `size` still holds a texel past its mip level `mip`: a level with a side of 1 texel is not made. */
export const holdsMip = (size: Point, mip: number) => size.x >> mip > 1 && size.y >> mip > 1

/** The rectangles as the words the passes read, four a rectangle (a single zero rectangle for none, which a buffer binding needs). */
export function slotWords(rects: readonly AtlasRect[]) {
  const words = new Uint32Array(Math.max(1, rects.length) * SLOT_WORDS)
  rects.forEach((r, at) => words.set([r.origin.x, r.origin.y, r.size.x, r.size.y], at * SLOT_WORDS))
  return words
}

/** The pictures' share and offset as the floats the add pass reads, four a slot (`x`, `y` the share, `z`, `w` the offset). */
export function scaleOffsetWords(slots: readonly AtlasSlot[]) {
  const words = new Float32Array(Math.max(1, slots.length) * 4)
  slots.forEach((slot, at) => words.set(slot.scaleOffset, at * 4))
  return words
}

/** The rectangles of the slots copied at mip level `mip`, where and from where: only the slots that still hold the level. */
export function copyRects(copies: readonly CopySlot[], mip: number) {
  const held = copies.filter((c) => holdsMip(c.size, mip))
  return {
    from: held.map((c) => rectAt(c.srcOrigin, c.size, mip)),
    to: held.map((c) => rectAt(c.dstOrigin, c.size, mip)),
  }
}

/** The rectangles of the slots filtered into mip level `mip` from the level over it: only the slots that still hold it. */
export function filterRects(slots: readonly AtlasSlot[], mip: number) {
  const held = slots.filter((s) => holdsMip(s.rect.size, mip))
  return {
    from: held.map((s) => rectAt(s.rect.origin, s.rect.size, mip - 1)),
    to: held.map((s) => rectAt(s.rect.origin, s.rect.size, mip)),
  }
}

/** What the passes read beside the slots (`PassFigures`): the size of the level drawn into, whether the share and offset of each slot are
 *  read, the mip level the picture is read at, the level a slot is copied from, the filter and the size of the level filtered from. */
export interface Figures {
  readonly atlas: Point
  readonly hasScaleOffset: boolean
  readonly mipBias?: number
  readonly mip?: number
  readonly quality?: number
  readonly source?: Point
}

/** The bytes of `figures`. */
export function figureBytes(f: Figures) {
  const bytes = new ArrayBuffer(FIGURE_BYTES)
  const floats = new Float32Array(bytes)
  const ints = new Int32Array(bytes)
  floats.set([f.atlas.x, f.atlas.y], 0)
  ints[2] = f.hasScaleOffset ? 1 : 0
  ints[3] = f.mipBias ?? 0
  ints[4] = f.mip ?? 0
  ints[5] = f.quality ?? 0
  floats.set([f.source?.x ?? 0, f.source?.y ?? 0], 6)
  return bytes
}
