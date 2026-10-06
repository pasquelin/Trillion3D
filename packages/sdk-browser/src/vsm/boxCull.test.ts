// The box cull the cache invalidation and the render cull share (`boxCullWgsl.ts`) gives each of
// them, bit for bit, what its own cull gave (`boxCullBefore.fixture.ts`): the frustum cull of a
// box, its rect in pixels and the mip level covering a rect, over seeded boxes and views with
// their edges — boxes flush with the frustum's sides and its near and far planes, corners at
// w = 0, empty extents, the f32 limits, infinities and NaN.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat } from '../texture/shaderRun.fixture.ts'
import { INVALIDATION_BOX_CULL, RENDER_BOX_CULL } from './boxCullBefore.fixture.ts'
import { INVALIDATION, RENDER, run } from './boxCullTables.fixture.ts'
import { inputs, sameBits } from './sameBits.fixture.ts'

const CULL_KEYS = ['clipLow', 'clipHigh', 'pastFar', 'pastNear', 'inMapView']
const CASES = 12000

/** A matrix of exact values — a diagonal, a translation and a w row (w = 1, or w = z) from a
 *  grid — whose boxes land on the frustum's sides, its planes and w = 0; else every value drawn. */
function matrix(d: ReturnType<typeof inputs>, exact: boolean) {
  if (!exact) return d.mat()
  const grid = [-2, -1, -0.5, 0, 0.5, 1, 2],
    perspective = d.bool()
  const s = () => d.pick([1, 0.5, 2, -1])
  return new Mat([
    ...[s(), 0, 0, 0, 0, s(), 0, 0],
    ...[0, 0, s(), perspective ? 1 : 0],
    ...[d.pick(grid), d.pick(grid), d.pick(grid), perspective ? 0 : 1],
  ])
}
/** A box: drawn, or exact (a centre on a grid, an extent of 0, ½ or 1). */
function box(d: ReturnType<typeof inputs>, exact: boolean) {
  if (!exact) return { center: d.vec(3), extent: d.vec(3) }
  return {
    center: d.vec(3, () => d.pick([-1, -0.5, 0, 0.5, 1, 1.5])),
    extent: d.vec(3, () => d.pick([0, 0.5, 1])),
  }
}
/** How many of the culls were visible, and how many crossed the near plane. */
const tally = (counts: number[], cull: Record<string, unknown>) => {
  counts[0] += Number(cull.inMapView === true)
  counts[1] += Number(cull.pastNear === true)
}

test("the invalidation's box cull is its own, bit for bit, the side-culled bit no one read gone", () => {
  // That bit was only ever written: neither the invalidation's pages nor its kernel read it.
  assert.ok(!INVALIDATION.includes('offSide'))
  const before = run(INVALIDATION_BOX_CULL, [
    ...[
      'vsmShiftedBoxInView',
      'vsmShiftedBoxOrtho',
      'vsmShiftedBoxPerspective',
      'vsmMin3v2',
      'vsmMax3v2',
    ],
  ])
  const after = run(INVALIDATION, [
    ...['vsmBoxInMapView', 'vsmBoxInOrthoView', 'vsmBoxInPerspectiveView'],
  ])
  const counts = [0, 0]
  for (let k = 0; k < CASES; k++) {
    const d = inputs(1000 + k),
      exact = k % 3 === 0
    const { center, extent } = box(d, exact)
    const args = [center, extent, matrix(d, exact), matrix(d, exact), matrix(d, exact)]
    const flags = [d.bool(), d.bool()]
    const was = before.vsmShiftedBoxInView(...args, ...flags) as Record<string, unknown>,
      is = after.vsmBoxInMapView(...args, ...flags) as Record<string, unknown>
    assert.ok(sameBits(was, is, CULL_KEYS), `case ${k}: ${JSON.stringify([was, is])}`)
    tally(counts, is)
  }
  assert.ok(counts[0] > CASES / 10 && counts[1] > CASES / 20, `${counts}`)
})

test("the render cull's box cull is its own, bit for bit", () => {
  const names = ['vsmShiftedBoxInView', 'vsmShiftedBoxOrtho', 'vsmShiftedBoxPerspective']
  const before = run(RENDER_BOX_CULL, names),
    after = run(RENDER, [...names, 'vsmBoxInOrthoView', 'vsmBoxInPerspectiveView'])
  const counts = [0, 0]
  for (let k = 0; k < CASES; k++) {
    const d = inputs(2000 + k),
      exact = k % 3 === 0
    const { center, extent } = box(d, exact)
    const args = [center, extent, matrix(d, exact), matrix(d, exact), d.bool(), d.bool()]
    const was = before.vsmShiftedBoxInView(...args) as Record<string, unknown>,
      is = after.vsmShiftedBoxInView(...args) as Record<string, unknown>
    assert.ok(sameBits(was, is, CULL_KEYS), `case ${k}: ${JSON.stringify([was, is])}`)
    tally(counts, is)
  }
  assert.ok(counts[0] > CASES / 10 && counts[1] > CASES / 20, `${counts}`)
})

test("a culled box's rect in pixels is each cull's own, bit for bit", () => {
  const invalidation = run(INVALIDATION_BOX_CULL, ['vsmPixelRectOf', 'vsmLevelHoldingRect']),
    render = run(RENDER_BOX_CULL, ['vsmRectPixels'])
  const shared = run(INVALIDATION, ['vsmRectPixels'])
  for (let k = 0; k < CASES; k++) {
    const d = inputs(3000 + k)
    // A mip's view of the full map, or a view rect anywhere; the rect drawn about the frustum.
    const dim = 16384 >> d.int(0, 7),
      x = k % 4 ? 0 : d.int(0, 4096),
      y = k % 4 ? 0 : d.int(0, 4096)
    const viewRect = [x, y, x + dim, y + dim]
    const near = () => (k % 2 ? d.pick([-1, -0.5, 0, 0.5, 1, 1 + 2 ** -20]) : d.f())
    const cull = { clipLow: d.vec(3, near), clipHigh: d.vec(3, near) }
    const was = (
      invalidation.vsmPixelRectOf(viewRect, cull.clipLow, cull.clipHigh, 4) as {
        pixels: number[]
      }
    ).pixels
    const is = shared.vsmRectPixels(viewRect, cull)
    assert.ok(sameBits(was, is), `case ${k}: ${JSON.stringify([was, is])}`)
    assert.ok(sameBits(render.vsmRectPixels(viewRect, cull), is), `case ${k}`)
  }
})

test("the mip level covering a rect is each cull's own, bit for bit", () => {
  const name = ['vsmLevelHoldingRect']
  const invalidation = run(INVALIDATION_BOX_CULL, name),
    render = run(RENDER_BOX_CULL, name),
    shared = [run(INVALIDATION, name), run(RENDER, name)]
  for (let k = 0; k < CASES; k++) {
    const d = inputs(4000 + k)
    // Rects of pixels or pages, from one texel to the whole map, a few empty or reversed.
    const x = d.int(0, 16384),
      y = d.int(0, 16384),
      size = () => (d.int(0, 15) === 0 ? -d.int(0, 8) : d.int(0, 2 ** d.int(0, 14)))
    const rect = [x, y, x + size(), y + size()],
      footprint = d.pick([1, 2, 4, 8, 16])
    const was = invalidation.vsmLevelHoldingRect(rect, footprint)
    assert.equal(render.vsmLevelHoldingRect(rect, footprint), was, `case ${k}`)
    for (const after of shared) assert.equal(after.vsmLevelHoldingRect(rect, footprint), was)
  }
})
