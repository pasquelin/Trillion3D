// The box cull the cache invalidation and the render cull share (`boxCullWgsl.ts`: `vsmBoxCullPoint`,
// `vsmBoxInView`), held to a golden of its every bit: the frustum cull of a box, its rect in pixels
// and the mip level covering a rect, over seeded boxes and views with their edges — boxes flush with
// the frustum's sides and its near and far planes, corners at w = 0, empty extents, the f32 limits,
// infinities and NaN. The goldens were taken when the shared cull was proved, case for case, the
// culls it replaced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat, matrixProduct } from '../texture/shaderRunMatrix.fixture.ts'
import { INVALIDATION, RENDER, run } from './boxCullTables.fixture.ts'
import { bitsDigest, inputs } from './sameBits.fixture.ts'

const CULL_KEYS = ['clipLow', 'clipHigh', 'pastFar', 'pastNear', 'inMapView']
/** The digests of the runs below (`bitsDigest`). */
const GOLDEN = {
  invalidation: 'f46b83814219d58c38450516a061636971ee0a282653ca54a09c9434f30aa36c',
  render: 'ee8d409e53b48fa8868bc55d010c27205c51622fbb67bab7b1ae7cb24f358b51',
  rect: '757a3921f99f6795e8577b3213f2bb4792bb0849361834b7f614678ec934b444',
  level: '6e9be750dfee4a40a942c2dfb6061f0c9c6c72945350d32c0bd754d76f7b7ba5',
}
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
/** The shared cull (`vsmBoxInView`) as each caller hands it a box: the clip image of its
 *  `vsmBoxCullPoint` and of its axes, through `toClip` after `toWorld` when the box has one. */
function sharedCull(
  after: Record<string, (...args: unknown[]) => unknown>,
  [center, extent, toWorld, toClip, viewToClip]: (number[] | Mat | null)[],
  flags: boolean[],
) {
  const clip = (v: number[]) => matrixProduct(toClip, toWorld ? matrixProduct(toWorld, v) : v)
  const point = after.vsmBoxCullPoint(center, extent, ...flags) as number[]
  const axes = [0, 1, 2].map((k) =>
    toWorld ? matrixProduct(toClip, (toWorld as Mat)[k]) : (toClip as Mat)[k],
  )
  return after.vsmBoxInView(clip([...point, 1]), ...axes, extent, viewToClip, ...flags) as Record<
    string,
    unknown
  >
}
const SHARED = ['vsmBoxCullPoint', 'vsmBoxInView', 'vsmBoxInOrthoView', 'vsmBoxInPerspectiveView']
/** How many of the culls were visible, and how many crossed the near plane. */
const tally = (counts: number[], cull: Record<string, unknown>) => {
  counts[0] += Number(cull.inMapView === true)
  counts[1] += Number(cull.pastNear === true)
}

test("the invalidation's box cull keeps its golden bits, the side-culled bit no one read gone", () => {
  // That bit was only ever written: neither the invalidation's pages nor its kernel read it.
  assert.ok(!INVALIDATION.includes('offSide'))
  const after = run(INVALIDATION, [...SHARED, 'perspectiveDivide'])
  const counts = [0, 0],
    digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const d = inputs(1000 + k),
      exact = k % 3 === 0
    const { center, extent } = box(d, exact)
    const args = [center, extent, matrix(d, exact), matrix(d, exact), matrix(d, exact)]
    const flags = [d.bool(), d.bool()]
    const is = sharedCull(after, args, flags)
    digest.add(is, CULL_KEYS)
    tally(counts, is)
  }
  assert.equal(digest.hex(), GOLDEN.invalidation)
  assert.ok(counts[0] > CASES / 10 && counts[1] > CASES / 20, `${counts}`)
})

test("the render cull's box cull keeps its golden bits", () => {
  const after = run(RENDER, [...SHARED, 'perspectiveDivide'])
  const counts = [0, 0],
    digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const d = inputs(2000 + k),
      exact = k % 3 === 0
    const { center, extent } = box(d, exact)
    const m = matrix(d, exact),
      viewToClip = matrix(d, exact),
      flags = [d.bool(), d.bool()]
    const is = sharedCull(after, [center, extent, null, m, viewToClip], flags)
    digest.add(is, CULL_KEYS)
    tally(counts, is)
  }
  assert.equal(digest.hex(), GOLDEN.render)
  assert.ok(counts[0] > CASES / 10 && counts[1] > CASES / 20, `${counts}`)
})

test("a culled box's rect in pixels keeps its golden bits, the same in both modules", () => {
  const render = run(RENDER, ['vsmRectPixels']),
    shared = run(INVALIDATION, ['vsmRectPixels'])
  const digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const d = inputs(3000 + k)
    // A mip's view of the full map, or a view rect anywhere; the rect drawn about the frustum.
    const dim = 16384 >> d.int(0, 7),
      x = k % 4 ? 0 : d.int(0, 4096),
      y = k % 4 ? 0 : d.int(0, 4096)
    const viewRect = [x, y, x + dim, y + dim]
    const near = () => (k % 2 ? d.pick([-1, -0.5, 0, 0.5, 1, 1 + 2 ** -20]) : d.f())
    const cull = { clipLow: d.vec(3, near), clipHigh: d.vec(3, near) }
    const is = shared.vsmRectPixels(viewRect, cull)
    digest.add(is)
    assert.deepEqual(render.vsmRectPixels(viewRect, cull), is, `case ${k}`)
  }
  assert.equal(digest.hex(), GOLDEN.rect)
})

test('the mip level covering a rect keeps its golden, the same in both modules', () => {
  const name = ['vsmLevelHoldingRect', 'floorLog2']
  const [invalidation, render] = [INVALIDATION, RENDER].map((text) => run(text, name))
  const digest = bitsDigest()
  for (let k = 0; k < CASES; k++) {
    const d = inputs(4000 + k)
    // Rects of pixels or pages, from one texel to the whole map, a few empty or reversed.
    const x = d.int(0, 16384),
      y = d.int(0, 16384),
      size = () => (d.int(0, 15) === 0 ? -d.int(0, 8) : d.int(0, 2 ** d.int(0, 14)))
    const rect = [x, y, x + size(), y + size()],
      footprint = d.pick([1, 2, 4, 8, 16])
    const level = invalidation.vsmLevelHoldingRect(rect, footprint)
    digest.add(level)
    assert.equal(render.vsmLevelHoldingRect(rect, footprint), level, `case ${k}`)
  }
  assert.equal(digest.hex(), GOLDEN.level)
})
