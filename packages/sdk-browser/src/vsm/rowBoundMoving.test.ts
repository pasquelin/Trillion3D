// Moving rows under the chunk bound (`rowPageBound.ts`): a histogram bins a moving placement's rows
// with their radius grown by how far the placements went over the last frames; a row that went
// past its old bin since — within that margin, or beyond it — still has its pages counted. The
// truth is the shipped cull at the rows' new places (`bruteForce`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { commitMotion } from '../gpu/shadow/rowMotion.ts'
import { createVsmRowBound, vsmBoundChunk, type VsmRowBound } from './rowPageBound.ts'
import { bruteForce, PAGES, scene, sunAt, worstOf, type SceneRows } from './rowPageBound.fixture.ts'
import { landBins, topSums } from './rowBins.fixture.ts'
import { CLUSTER_SPHERE_FLOATS } from '../gpu/shadow/sphereContract.ts'

type Sun = ReturnType<typeof sunAt>
const N = 1600

/** This frame's chunk, every K above the brute force of the rows where they are now. */
function above(rows: SceneRows, sun: Sun, bound: VsmRowBound) {
  const range = { first: 0, end: N, candidates: N }
  const chunk = vsmBoundChunk(bound, rows.spheres, range, [sun.light], worstOf())
  assert.ok(chunk, 'the histogram bounds the rows')
  const truth = bruteForce(rows, sun.light, PAGES)
  const pairs = topSums(truth.pairs),
    cmds = topSums(truth.cmds)
  for (let k = 1; k <= N; k += 13) {
    assert.ok(chunk.pairs(k) >= pairs[k], `pairs of ${k} rows: ${chunk.pairs(k)} < ${pairs[k]}`)
    assert.ok(chunk.cmds(k) >= cmds[k], `commands of ${k} rows`)
  }
  return chunk
}

/** Every moving row of `rows` moved by `step` (metres, world), the frame's travel committed. */
function move(rows: SceneRows, step: number[]) {
  for (let i = 0; i < N; i++) {
    if (!rows.moving[i]) continue
    const at = i * CLUSTER_SPHERE_FLOATS
    for (let a = 0; a < 3; a++) {
      const c = rows.packed[at + a] + rows.packed[at + 4 + a] + step[a]
      rows.packed[at + a] = Math.fround(c)
      rows.packed[at + 4 + a] = c - rows.packed[at + a]
    }
  }
  commitMotion(rows.spheres.motion, 0, Math.hypot(...step))
}

/** A dense oblique scene: small rows around the camera and far ones, every other one moving. */
function moving(seed: number) {
  const rows = scene(N, [0, 0, 0], 600, 0.02, 0.5, seed)
  for (let i = 0; i < N; i += 2) rows.moving[i] = 1
  const sun = sunAt([0.4, 1.8, -0.3]),
    bound = createVsmRowBound()
  return { rows, sun, bound }
}
const land = ({ rows, sun, bound }: ReturnType<typeof moving>) =>
  landBins(bound, rows, { first: 0, end: N }, [sun.light])

test('a moving row past its old bin, with no margin binned, still gets its pages', () => {
  const s = moving(3)
  land(s)
  above(s.rows, s.sun, s.bound)
  // Each moving row crosses the levels: far ones in, near ones out.
  move(s.rows, [-150, 0, 80])
  const chunk = above(s.rows, s.sun, s.bound)
  // Past the margin: the moving rows are counted whole.
  assert.equal(chunk.pairs(N / 2), (N / 2) * PAGES)
})

test('moving rows within the margin they were binned at stay in their bins', () => {
  const s = moving(5)
  // The placements went 2 m a frame: a new histogram's moving rows are binned that far grown.
  for (let f = 0; f < 10; f++) commitMotion(s.rows.spheres.motion, 0, 2)
  land(s)
  for (let f = 0; f < 3; f++) {
    move(s.rows, [1.2, 0, -1.6])
    const chunk = above(s.rows, s.sun, s.bound)
    assert.ok(chunk.pairs(N / 2) < (N / 2) * PAGES, `frame ${f}: tighter than every page a row`)
  }
  // Then farther than the margin in one frame: counted whole, still above.
  move(s.rows, [60, 0, 0])
  above(s.rows, s.sun, s.bound)
})

test('still rows are binned as they are: a margin grows only the moving ones', () => {
  const s = moving(7)
  for (let f = 0; f < 10; f++) commitMotion(s.rows.spheres.motion, 0, 50)
  land(s)
  const landed = s.bound.bins.landed!
  assert.ok(landed.margin >= 150, `${landed.margin} m`)
  assert.equal(landed.movingRows, N / 2)
  above(s.rows, s.sun, s.bound)
})
