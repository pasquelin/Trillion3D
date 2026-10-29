import {
  type AtlasLayout,
  type AtlasRect,
  type AtlasSlot,
  type CopySlot,
  type Horizon,
  type Point,
  INVALID_ORIGIN,
  alignSlotSize,
  copyRect,
  hasPlace,
  newLayout,
  newRect,
  slotMaxMipLevel,
  sourceResolution,
  toMip,
} from './layout.ts'

/**
 * THE PACKING OF THE ATLAS: a skyline (horizon) packing with the holes of the deleted slots tried first. A slot is aligned on the power of two
 * of its coarsest mip level, so that the levels of two neighbours never mix. When a new slot does not fit, the layout is made again from
 * nothing — the atlas doubled up to its greatest side, then every picture read one mip level smaller until all fit.
 */

const rect = (x: number, y: number, width: number, height: number): AtlasRect => ({
  origin: { x, y },
  size: { x: width, y: height },
})
const horizon = (line: AtlasRect): Horizon => ({ line, extended: copyRect(line) })

const canContain = (outside: AtlasRect, inside: AtlasRect) =>
  inside.size.x <= outside.size.x && inside.size.y <= outside.size.y

/** `r` cut to the part whose origin respects `alignment`: smaller, its origin on the alignment grid. */
function alignedRect(r: AtlasRect, alignment: number): AtlasRect {
  const x = Math.ceil(r.origin.x / alignment) * alignment
  const y = Math.ceil(r.origin.y / alignment) * alignment
  return rect(x, y, r.size.x + r.origin.x - x, r.size.y + r.origin.y - y)
}

/** Places `slot` in the smallest free rectangle that holds it, and splits what is left of that rectangle into new free rectangles. */
function findFreeRect(layout: AtlasLayout, slot: AtlasSlot, alignment: number) {
  let best = -1
  let bestWidth = layout.width * 2
  let bestAligned = newRect()
  layout.freeRects.forEach((free, at) => {
    const aligned = alignedRect(free, alignment)
    // The smallest is found among the aligned rectangles, each as the slot sees it.
    if (canContain(aligned, slot.rect) && aligned.size.x < bestWidth) {
      best = at
      bestWidth = aligned.size.x
      bestAligned = aligned
    }
  })
  if (best === -1) return false
  slot.rect.origin = { ...bestAligned.origin }
  const free = layout.freeRects[best]
  // The last takes its place (a swap removal).
  layout.freeRects[best] = layout.freeRects[layout.freeRects.length - 1]
  layout.freeRects.pop()
  const slotEndX = slot.rect.origin.x + slot.rect.size.x
  const slotEndY = slot.rect.origin.y + slot.rect.size.y
  const freeEndX = free.origin.x + free.size.x
  const freeEndY = free.origin.y + free.size.y
  const fitX = slotEndX === freeEndX
  const fitY = slotEndY === freeEndY
  if (fitX && fitY) return true
  if (fitX) {
    // The slot reaches the free rectangle's right edge: what is left is the strip under it.
    layout.freeRects.push(rect(free.origin.x, slotEndY, free.size.x, freeEndY - slotEndY))
  } else if (fitY) {
    // The slot reaches its bottom edge: what is left is the column beside it.
    layout.freeRects.push(rect(slotEndX, free.origin.y, freeEndX - slotEndX, free.size.y))
  } else {
    // Two splits: the strip under the slot, then the column beside the free rectangle's top.
    layout.freeRects.push(
      rect(free.origin.x, slotEndY, slotEndX - free.origin.x, freeEndY - slotEndY),
    )
    layout.freeRects.push(rect(slotEndX, free.origin.y, freeEndX - slotEndX, free.size.y))
  }
  return true
}

/** A horizon line from `x` for `width`, standing at height `y`, down to the atlas's end. */
const lineAt = (layout: AtlasLayout, x: number, y: number, width: number) =>
  horizon(rect(x, y, width, layout.height - y))

/** The horizons after a slot from `startX` to `endX` stands on them at height `slotY`: each horizon it touches is cut around it. */
function updateHorizons(layout: AtlasLayout, startX: number, endX: number, slotY: number) {
  const next: Horizon[] = []
  for (const h of layout.horizons) {
    const hStart = h.line.origin.x
    const hEnd = hStart + h.line.size.x
    const hY = h.line.origin.y
    if (endX < hStart || startX > hEnd) {
      next.push({ line: h.line, extended: copyRect(h.line) })
      continue
    }
    const slotLine = () => lineAt(layout, startX, slotY, endX - startX)
    if (startX <= hStart && endX >= hEnd) {
      // The slot covers the horizon whole: the slot's own line stands in its place, once, at the first it covers.
      if (startX === hStart) next.push(slotLine())
    } else if (startX > hStart && endX < hEnd) {
      next.push(
        lineAt(layout, hStart, hY, startX - hStart),
        slotLine(),
        lineAt(layout, endX, hY, hEnd - endX),
      )
    } else if (startX <= hStart && endX < hEnd) {
      // The slot's line may stand already, from the horizon it covered whole: it is not put twice.
      const last = next[next.length - 1]
      const stands =
        last &&
        last.line.origin.x === startX &&
        last.line.origin.y === slotY &&
        last.line.size.x === endX - startX
      if (!stands) next.push(slotLine())
      next.push(lineAt(layout, endX, hY, hEnd - endX))
    } else if (startX > hStart && endX <= hEnd) {
      next.push(lineAt(layout, hStart, hY, startX - hStart), slotLine())
    } else if (startX > hStart && startX < hEnd) {
      next.push(lineAt(layout, hStart, hY, startX - hStart), slotLine())
    } else {
      // The slot only touches the horizon's end.
      next.push({ line: h.line, extended: copyRect(h.line) })
    }
  }
  layout.horizons = next
}

/** The lines each horizon extends to: over the lower lines beside it, swept left to right, then right to left. */
function extendHorizons(layout: AtlasLayout) {
  const hs = layout.horizons
  if (!hs.length) return
  let stack: Array<{ x: number; y: number }> = [{ x: 0, y: layout.height + 1 }]
  for (const h of hs) {
    while (h.line.origin.y >= stack[stack.length - 1].y && stack.length > 1) stack.pop()
    h.extended.origin.x = stack[stack.length - 1].x
    h.extended.size.x += h.line.origin.x - h.extended.origin.x
    stack.push({ x: h.line.origin.x + h.line.size.x, y: h.line.origin.y })
  }
  stack = [{ x: layout.width, y: layout.height + 1 }]
  for (let at = hs.length - 1; at >= 0; at--) {
    const h = hs[at]
    while (h.line.origin.y >= stack[stack.length - 1].y && stack.length > 1) stack.pop()
    h.extended.size.x = stack[stack.length - 1].x - h.extended.origin.x
    stack.push({ x: h.line.origin.x, y: h.line.origin.y })
  }
}

/** Fits `slot` into `layout`: a free rectangle first, else the horizon that leaves the lowest line. Whether it fits. */
export function fitAlignedSlot(layout: AtlasLayout, slot: AtlasSlot) {
  const alignment = 2 ** slotMaxMipLevel(slot.rect.size)
  if (!layout.horizons.length)
    layout.horizons.push(horizon(rect(0, 0, layout.width, layout.height)))
  if (findFreeRect(layout, slot, alignment)) return true
  let minHeight = layout.height * 2
  let bestAt = -1
  let bestAligned = newRect()
  layout.horizons.forEach((h, at) => {
    const aligned = alignedRect(h.extended, alignment)
    if (canContain(aligned, slot.rect) && aligned.origin.y + slot.rect.size.y < minHeight) {
      minHeight = aligned.origin.y + slot.rect.size.y
      bestAligned = aligned
      bestAt = at
    }
  })
  if (bestAt === -1) return false
  slot.rect.origin = { ...bestAligned.origin }
  const startX = slot.rect.origin.x
  updateHorizons(layout, startX, startX + slot.rect.size.x, slot.rect.origin.y + slot.rect.size.y)
  extendHorizons(layout)
  return true
}

/** The holes the deleted slots leave join the layout's free rectangles. */
export function cleanAtlas(layout: AtlasLayout, deleted: readonly AtlasRect[]) {
  for (const r of deleted)
    if (r.origin.x >= 0 && r.origin.y >= 0) layout.freeRects.push(copyRect(r))
}

const byPerimeter = (a: AtlasSlot, b: AtlasSlot) =>
  b.rect.size.x + b.rect.size.y - (a.rect.size.x + a.rect.size.y)

/** What a packing returns: the slots that are new (with their place) and the slots that move from the old atlas. */
export interface Packing {
  newSlots: AtlasSlot[]
  copySlots: CopySlot[]
}

/** `slot` given the size its picture has at mip bias `bias`, no place yet. */
function resize(slot: AtlasSlot, size: Point, bias: number) {
  slot.rect.origin = { x: INVALID_ORIGIN, y: INVALID_ORIGIN }
  slot.rect.size = toMip(size, bias)
  alignSlotSize(slot.rect)
  slot.cachedSize = { ...size }
}

const copyOf = (slot: AtlasSlot): AtlasSlot => ({
  ...slot,
  rect: copyRect(slot.rect),
  cachedSize: { ...slot.cachedSize },
})

/**
 * Fits the slots that have no place in the layout into it, else makes the layout again (`state.layout` is replaced): every slot is placed
 * from nothing, in the atlas as it was and then doubled up to `maxResolution`, then with every picture read one mip level smaller. A
 * picture that grew (streamed in) or is forced to refresh is sized again first.
 */
export function packAtlas(
  state: { layout: AtlasLayout },
  slots: readonly AtlasSlot[],
  maxResolution: number,
  maxRatio: number,
): Packing {
  const valid: AtlasSlot[] = []
  const added: AtlasSlot[] = []
  for (const slot of slots) {
    if (!slot.source) continue
    const mine = copyOf(slot)
    valid.push(mine)
    const size = sourceResolution(mine.source, mine.scaleOffset, maxRatio)
    // A slot with no place (new, or its layout made again) is sized for the layout's bias: its picture is drawn that many levels smaller.
    if (
      !hasPlace(mine.rect) ||
      mine.cachedSize.x !== size.x ||
      mine.cachedSize.y !== size.y ||
      mine.forceRefresh
    )
      resize(mine, size, state.layout.sourceMipBias)
    if (!hasPlace(mine.rect)) added.push(mine)
  }
  valid.sort(byPerimeter)
  added.sort(byPerimeter)
  const packing: Packing = { newSlots: [], copySlots: [] }
  let refit = false
  for (const slot of added) {
    const placed = copyOf(slot)
    if (!fitAlignedSlot(state.layout, placed)) {
      refit = true
      break
    }
    packing.newSlots.push(placed)
  }
  if (!refit) return packing
  packing.newSlots = []
  let side = state.layout.width
  let bias = 0
  // The layout starts again at bias 0: the pictures that were drawn smaller are sized in full, to be drawn again.
  if (state.layout.sourceMipBias > 0) {
    for (const slot of valid)
      resize(slot, sourceResolution(slot.source, slot.scaleOffset, maxRatio), 0)
    valid.sort(byPerimeter)
  }
  for (;;) {
    state.layout = newLayout(side, side)
    state.layout.sourceMipBias = bias
    let fits = true
    for (const src of valid) {
      const dst = copyOf(src)
      if (!fitAlignedSlot(state.layout, dst)) {
        fits = false
        break
      }
      if (!hasPlace(src.rect)) packing.newSlots.push(dst)
      else
        packing.copySlots.push({
          id: src.id,
          size: { ...src.rect.size },
          srcOrigin: { ...src.rect.origin },
          dstOrigin: { ...dst.rect.origin },
          source: src.source!,
        })
    }
    if (fits) return packing
    if (state.layout.width * 2 <= maxResolution && state.layout.height * 2 <= maxResolution)
      side = state.layout.width * 2
    else {
      // The atlas is at its greatest side: every picture is read one mip level smaller.
      bias++
      for (const slot of valid) {
        resize(slot, sourceResolution(slot.source, slot.scaleOffset, maxRatio), bias)
      }
    }
    packing.copySlots = []
    packing.newSlots = []
  }
}
