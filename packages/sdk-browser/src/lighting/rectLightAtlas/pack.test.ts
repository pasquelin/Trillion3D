// The packing of the atlas: where slots are put, how the holes of deleted slots are reused, and what happens when nothing fits.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INVALID_ORIGIN,
  freeSlot,
  newLayout,
  slotMaxMipLevel,
  type AtlasRect,
  type AtlasSlot,
} from './layout.ts'
import { cleanAtlas, fitAlignedSlot, packAtlas } from './pack.ts'

let nextId = 0
/** A slot of a picture of `size` by `size` shown whole. */
function slotOf(width: number, height = width): AtlasSlot {
  const slot = freeSlot()
  slot.id = nextId++
  slot.source = { width, height }
  slot.scaleOffset = [1, 1, 0, 0]
  slot.rect.size = { x: width, y: height }
  slot.cachedSize = { x: width, y: height }
  return slot
}

const overlaps = (a: AtlasRect, b: AtlasRect) =>
  a.origin.x < b.origin.x + b.size.x &&
  b.origin.x < a.origin.x + a.size.x &&
  a.origin.y < b.origin.y + b.size.y &&
  b.origin.y < a.origin.y + a.size.y

const noOverlaps = (rects: readonly AtlasRect[]) =>
  rects.every((a, i) => rects.every((b, j) => i === j || !overlaps(a, b)))

test('slots are put in the atlas, aligned on their last mip level, inside it and apart', () => {
  const layout = newLayout(256)
  const slots = [slotOf(128), slotOf(64), slotOf(64), slotOf(100, 36), slotOf(32)]
  for (const slot of slots) {
    assert.ok(fitAlignedSlot(layout, slot), 'it fits')
    const align = 2 ** slotMaxMipLevel(slot.rect.size)
    assert.equal(slot.rect.origin.x % align, 0)
    assert.equal(slot.rect.origin.y % align, 0)
    assert.ok(slot.rect.origin.x + slot.rect.size.x <= 256)
    assert.ok(slot.rect.origin.y + slot.rect.size.y <= 256)
  }
  assert.ok(noOverlaps(slots.map((s) => s.rect)))
})

test('a slot that does not fit is refused', () => {
  const layout = newLayout(64)
  assert.ok(fitAlignedSlot(layout, slotOf(64)))
  assert.equal(fitAlignedSlot(layout, slotOf(32)), false)
  assert.equal(fitAlignedSlot(newLayout(64), slotOf(128)), false)
})

test('a deleted slot’s hole is used before the atlas grows, whole or split', () => {
  const layout = newLayout(128)
  const a = slotOf(64)
  const b = slotOf(64)
  const c = slotOf(64)
  const d = slotOf(64)
  for (const s of [a, b, c, d]) assert.ok(fitAlignedSlot(layout, s))
  assert.equal(fitAlignedSlot(layout, slotOf(32)), false, 'the atlas is full')
  cleanAtlas(layout, [b.rect])
  const small = slotOf(32)
  assert.ok(fitAlignedSlot(layout, small), 'it takes the hole')
  assert.deepEqual(small.rect.origin, b.rect.origin)
  // What is left of the hole is two free rectangles of the sizes the cut leaves, and the next small slot takes one.
  const next = slotOf(32)
  assert.ok(fitAlignedSlot(layout, next))
  const third = slotOf(32)
  const last = slotOf(32)
  assert.ok(fitAlignedSlot(layout, third))
  assert.ok(fitAlignedSlot(layout, last))
  assert.ok(noOverlaps([a, c, d, small, next, third, last].map((s) => s.rect)))
  assert.equal(layout.freeRects.length, 0, 'the hole is used up: 64 by 64 is four slots of 32')
  assert.equal(fitAlignedSlot(layout, slotOf(32)), false)
})

test('a hole that is exact leaves no free rectangle, and one cut on a side leaves the other', () => {
  const layout = newLayout(128)
  const wide = slotOf(128, 32)
  assert.ok(fitAlignedSlot(layout, wide))
  cleanAtlas(layout, [wide.rect])
  const half = slotOf(64, 32)
  assert.ok(fitAlignedSlot(layout, half))
  assert.equal(layout.freeRects.length, 1, 'the right half, as wide as the rest')
  assert.deepEqual(layout.freeRects[0].origin, { x: 64, y: 0 })
  assert.deepEqual(layout.freeRects[0].size, { x: 64, y: 32 })
  const rest = slotOf(64, 32)
  assert.ok(fitAlignedSlot(layout, rest))
  assert.equal(layout.freeRects.length, 0)
})

test('the holes of slots never placed are not kept', () => {
  const layout = newLayout(64)
  cleanAtlas(layout, [{ origin: { x: INVALID_ORIGIN, y: INVALID_ORIGIN }, size: { x: 32, y: 32 } }])
  assert.equal(layout.freeRects.length, 0)
})

test('new slots are packed into the layout held, and nothing is copied', () => {
  const state = { layout: newLayout(256) }
  const slots = [slotOf(64), slotOf(128)]
  const packing = packAtlas(state, slots, 4096, 2)
  assert.equal(packing.newSlots.length, 2)
  assert.equal(packing.copySlots.length, 0)
  assert.equal(state.layout.width, 256)
  assert.ok(noOverlaps(packing.newSlots.map((s) => s.rect)))
})

test('when the new slots do not fit, the layout is made again at twice the side, the slots in place copied', () => {
  const state = { layout: newLayout(256) }
  const kept = slotOf(256)
  const first = packAtlas(state, [kept], 4096, 2)
  kept.rect = first.newSlots[0].rect
  const big = slotOf(256)
  const again = packAtlas(state, [kept, big], 4096, 2)
  assert.equal(state.layout.width, 512)
  assert.equal(again.copySlots.length, 1, 'the slot that had a place moves')
  assert.equal(again.copySlots[0].id, kept.id)
  assert.equal(again.newSlots.length, 1)
  assert.equal(again.newSlots[0].id, big.id)
})

test('at the greatest side the pictures are read one mip level smaller until they fit', () => {
  const state = { layout: newLayout(128) }
  const slots = [slotOf(128), slotOf(128), slotOf(128), slotOf(128), slotOf(128)]
  const packing = packAtlas(state, slots, 256, 2)
  assert.equal(state.layout.width, 256)
  assert.equal(state.layout.sourceMipBias, 1)
  assert.equal(packing.newSlots.length, 5)
  for (const s of packing.newSlots) assert.deepEqual(s.rect.size, { x: 64, y: 64 })
  assert.ok(noOverlaps(packing.newSlots.map((s) => s.rect)))
})

test('a slot that horizon packing covers twice is put once on the horizon', () => {
  const layout = newLayout(256)
  const slots = [slotOf(64), slotOf(64), slotOf(128, 64), slotOf(256, 32)]
  for (const slot of slots) assert.ok(fitAlignedSlot(layout, slot))
  const lines = layout.horizons.map((h) => `${h.line.origin.x},${h.line.origin.y},${h.line.size.x}`)
  assert.equal(new Set(lines).size, lines.length, 'no horizon line is written twice')
  assert.ok(noOverlaps(slots.map((s) => s.rect)))
})

test('a packing of many random slots never overlaps and stays inside the atlas', () => {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const state = { layout: newLayout(256) }
  const slots: AtlasSlot[] = []
  for (let i = 0; i < 60; i++) {
    const w = 8 + Math.floor(random() * 120)
    const h = 8 + Math.floor(random() * 120)
    const s = slotOf(w, h)
    s.rect.size = { x: w, y: h }
    slots.push(s)
  }
  const packing = packAtlas(state, slots, 2048, 2)
  const placed = [...packing.newSlots]
  assert.equal(placed.length, 60)
  for (const s of placed) {
    assert.ok(s.rect.origin.x + s.rect.size.x <= state.layout.width)
    assert.ok(s.rect.origin.y + s.rect.size.y <= state.layout.height)
  }
  assert.ok(noOverlaps(placed.map((s) => s.rect)))
})

test('a layout made again after pictures were read smaller sizes them in full, and a new slot is sized for the layout it joins', () => {
  const state = { layout: newLayout(128) }
  const slots = [slotOf(128), slotOf(128), slotOf(128), slotOf(128), slotOf(128)]
  const small = packAtlas(state, slots, 256, 2)
  assert.equal(state.layout.sourceMipBias, 1)
  slots.forEach((s, at) => (s.rect = small.newSlots[at].rect))
  const added = slotOf(128)
  const joined = packAtlas(state, [...slots, added], 256, 2)
  assert.deepEqual(joined.newSlots.find((s) => s.id === added.id)?.rect.size, { x: 64, y: 64 })
  const again = packAtlas(
    { layout: newLayout(256) },
    slots.map((s) => ({
      ...s,
      rect: { ...s.rect, origin: { x: INVALID_ORIGIN, y: INVALID_ORIGIN } },
    })),
    256,
    2,
  )
  assert.equal(again.newSlots.length, 5)
})
