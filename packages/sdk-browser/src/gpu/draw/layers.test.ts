import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BASE_SLOTS,
  BIN_BACK,
  BIN_FRONT,
  BIN_NONE,
  CULL_BINS,
  HALF_SLOTS,
  slotCount,
} from './draw.ts'
import { evaluateDrawCompact } from './cpu.fixture.ts'
import type { DrawItem } from './cpu.fixture.ts'
import { drawShader } from './shader.ts'

// Behaviour 16: a layer-n item goes to slot bin + HALF_SLOTS·rest + BASE_SLOTS·n — its bin the face
// mode, plus CULL_BINS on a cutout row —, and layerSlots = 1 (a scene with no stacked coplanar
// layer) folds every layer into layer 0's slots.
test('evaluateDrawCompact places layer n items at slot bin + HALF_SLOTS*rest + BASE_SLOTS*n', () => {
  const items: DrawItem[] = [
    { pageIndex: 10, bin: BIN_BACK, rest: 0, layer: 0 },
    { pageIndex: 11, bin: BIN_FRONT, rest: 1, layer: 1 },
    { pageIndex: 12, bin: BIN_NONE, rest: 0, layer: 2 },
    { pageIndex: 13, bin: BIN_NONE + CULL_BINS, rest: 1, layer: 2 },
  ]
  const result = evaluateDrawCompact(items, 768, 8, 3)
  assert.equal(result.counts.length, slotCount(3))
  assert.equal(result.counts.length, 3 * BASE_SLOTS)
  const slotOf = (item: DrawItem) => item.bin + HALF_SLOTS * item.rest + BASE_SLOTS * item.layer!
  for (const item of items) assert.equal(result.counts[slotOf(item)], 1)
  assert.deepEqual(items.map(slotOf), [0, 2 + 6 + 12, 1 + 24, 4 + 6 + 24])
  assert.equal(
    result.counts.reduce((sum, count) => sum + count, 0),
    items.length,
  )
})

test("layerSlots = 1 collapses every layer into layer 0's slots", () => {
  const items: DrawItem[] = [
    { pageIndex: 0, bin: BIN_BACK, rest: 0, layer: 0 },
    { pageIndex: 1, bin: BIN_BACK, rest: 0, layer: 5 },
    { pageIndex: 2, bin: BIN_BACK, rest: 0, layer: 15 },
  ]
  const result = evaluateDrawCompact(items, 768, 8, 1)
  assert.equal(result.counts.length, BASE_SLOTS)
  assert.equal(result.counts.length, slotCount(1))
  // The three items, of different layers, all land in the same slot bin+HALF_SLOTS*rest.
  assert.equal(result.counts[BIN_BACK], 3)
  assert.deepEqual([...result.instances], [0, 1, 2])
})

// Behaviour 17: drawShader(k) opens exactly BASE_SLOTS·k slots in its own text, and computes a
// slot as the CPU mirror does.
test('drawShader(k) opens exactly BASE_SLOTS*k slots for several k', () => {
  for (const k of [1, 2, 3, 5]) {
    const shader = drawShader(k)
    const slots = slotCount(k)
    assert.equal(slots, BASE_SLOTS * k)
    assert.match(shader, new RegExp(`groupCounts\\[group\\*${slots}u\\+slot\\]`))
    assert.match(shader, new RegExp(`slot<${slots}u`))
  }
})

test('drawShader(k) computes a slot as bin + HALF_SLOTS*rest + BASE_SLOTS*layer, the layer capped', () => {
  for (const k of [1, 3]) {
    const slotOfBody = /fn slotOf\([^)]*\)->u32\{return ([^;]+);\}/.exec(drawShader(k))
    assert.equal(
      slotOfBody![1],
      `restAt(i)*${HALF_SLOTS}u+item.bin+${BASE_SLOTS}u*min(item.layer,${k - 1}u)`,
    )
  }
})
