// The rules of the occlusion test: it never culls a box that could be seen, counts every box once,
// and keeps what it cannot prove hidden. (The occluder split is in `splitOccluders.test.ts`.)
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import {
  countUnoccluded,
  createHizCounts,
  filterUnoccluded,
  type HizCounts,
} from './unoccluded.fixture.ts'
import type { HizPage } from './types.ts'
import { buildHizPyramid } from '../../../../bench/oracles/browser/hizPyramid.ts'
import { cameraAt, occluderPyramid, quad } from '../../../../tests/fixtures/hiz.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { DEPTH_CLEAR } from '../camera/depthConvention.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { bounds, box, randomBox, type Tagged } from './occlusionCuts.fixture.ts'

/** A full-screen occluder at the origin plane, seen from z = 5: everything behind it is hidden. */
function wall(size: [number, number]) {
  const material = G.basicSurface()
  const { page, geometry } = quad(material, [-6, -6, 0], [6, 6, 0], 'wall')
  const pyramid = occluderPyramid([page], engineCamera(cameraAt()), size)
  geometry.dispose()
  material.dispose()
  return pyramid
}

test('a box behind a wall that covers the view is rejected, one in front of it is kept', () => {
  const size: [number, number] = [48, 48]
  const pyramid = wall(size)
  const pages = [
    box([-0.5, -0.5, -4], [0.5, 0.5, -3], 0, 10), // Behind the wall.
    box([-0.5, -0.5, 1], [0.5, 0.5, 2], 1, 20), // In front of it.
  ]
  const counts = createHizCounts()
  const kept = countUnoccluded(
    pages,
    identityRoots(),
    pyramid,
    engineCamera(cameraAt()),
    size,
    counts,
  )
  assert.deepEqual(
    kept.map((p) => p.tag),
    [1],
  )
  assert.equal(counts.tested, 2)
  assert.equal(counts.testedTriangles, 30)
  assert.equal(counts.rejected, 1)
  assert.equal(counts.rejectedTriangles, 10)
})

test('the test never culls a box that could be seen, over generated cuts and occluders', () => {
  const rand = lcgRandom(31)
  const size: [number, number] = [40, 36]
  const cam = engineCamera(cameraAt())
  let rejected = 0
  for (let round = 0; round < 30; round++) {
    // Random occluding quads: some pixels of the pyramid hold a depth, some stay background.
    const mats: G.GraphSurface[] = [],
      quads = []
    for (let q = 0; q < 1 + Math.floor(rand() * 4); q++) {
      const material = G.basicSurface()
      mats.push(material)
      const cx = (rand() - 0.5) * 4,
        cy = (rand() - 0.5) * 4,
        h = 0.4 + rand() * 2.5,
        z = -4 + rand() * 7
      quads.push(quad(material, [cx - h, cy - h, z], [cx + h, cy + h, z], `q${q}`))
    }
    const pyramid = occluderPyramid(
      quads.map((q) => q.page),
      cam,
      size,
    )
    const pages = Array.from({ length: 50 }, (_, i) => randomBox(rand, i))
    const counts = createHizCounts()
    const kept = new Set(
      countUnoccluded(pages, identityRoots(), pyramid, cam, size, counts).map((p) => p.tag),
    )
    for (const page of pages) {
      if (kept.has(page.tag)) continue
      rejected++
      // A rejected box is not crossing the near plane, and every texel its screen rectangle
      // can paint holds a surface strictly nearer than the box's nearest point.
      const b = bounds(page, cameraAt(), size)
      assert.equal(b.clipsNear, false)
      const x0 = Math.max(0, b.minX),
        y0 = Math.max(0, b.minY),
        x1 = Math.min(size[0] - 1, b.maxX),
        y1 = Math.min(size[1] - 1, b.maxY)
      assert.ok(x1 >= x0 && y1 >= y0, `box ${page.tag} reaches no pixel`)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          assert.ok(
            pyramid.data[y * size[0] + x] > b.nearestDepth,
            `box ${page.tag} rejected over a texel not nearer than it`,
          )
    }
    assert.equal(counts.tested, pages.length)
    assert.equal(counts.rejected, pages.length - kept.size)
    for (const q of quads) q.geometry.dispose()
    for (const m of mats) m.dispose()
  }
  assert.ok(rejected > 20, 'the generator hides enough boxes to prove something')
})

test('nothing is rejected over an empty pyramid, a near-plane crossing or a box with no extent', () => {
  const size: [number, number] = [32, 32]
  const cam = engineCamera(cameraAt(0.5, 0.1))
  const empty = buildHizPyramid(new Float32Array(32 * 32).fill(DEPTH_CLEAR), 32, 32)
  const pages = [
    box([-0.4, -0.4, -3], [0.4, 0.4, -3], 0),
    box([-5, -5, -5], [5, 5, 5], 1),
    box([NaN, 0, -3], [0, 0, -3], 2),
  ]
  const kept = countUnoccluded(pages, identityRoots(), empty, cam, size, createHizCounts())
  assert.equal(kept.length, pages.length)
  // A wall in front: still no page that clips the near plane or has a NaN bound is rejected.
  const solid = buildHizPyramid(new Float32Array(32 * 32).fill(0.9), 32, 32)
  const rejected = new Set(
    pages
      .filter(
        (p) => !countUnoccluded([p], identityRoots(), solid, cam, size, createHizCounts()).length,
      )
      .map((p) => p.tag),
  )
  assert.equal(rejected.has(1), false)
  assert.equal(rejected.has(2), false)
})

test('a page whose surface is never culled is kept behind a wall, and the ranks of the kept are given', () => {
  const size: [number, number] = [48, 48]
  const pyramid = wall(size)
  const behind = (tag: number, material?: HizPage['material']): Tagged => ({
    ...box([-0.5, -0.5, -4], [0.5, 0.5, -3], tag, 5),
    material,
  })
  const pages = [
    behind(0),
    behind(1, { sprite: { sizeAttenuation: false } } as HizPage['material']),
    behind(2),
  ]
  const ranks: number[] = []
  const counts: HizCounts = createHizCounts()
  const kept = countUnoccluded(
    pages,
    identityRoots(),
    pyramid,
    engineCamera(cameraAt()),
    size,
    counts,
    ranks,
  )
  assert.deepEqual(
    kept.map((p) => p.tag),
    [1],
  )
  assert.deepEqual(ranks, [1])
  assert.equal(counts.rejected, 2)
  const filtered = filterUnoccluded(pages, identityRoots(), pyramid, engineCamera(cameraAt()), size)
  assert.deepEqual(
    filtered.map((p) => p.tag),
    [1],
  )
})

test('a bias keeps what the wall hides by less than the bias, and the counts add up', () => {
  const size: [number, number] = [48, 48]
  const pyramid = wall(size)
  const cam = engineCamera(cameraAt())
  // A box a hair behind the wall: hidden with no bias, kept once the bias exceeds the gap.
  const page = box([-0.5, -0.5, -0.01], [0.5, 0.5, -0.01], 0, 4)
  assert.equal(filterUnoccluded([page], identityRoots(), pyramid, cam, size).length, 0)
  assert.equal(filterUnoccluded([page], identityRoots(), pyramid, cam, size, 0.5).length, 1)
  const rand = lcgRandom(3)
  const pages = Array.from({ length: 80 }, (_, i) => randomBox(rand, i))
  const counts = createHizCounts()
  const kept = countUnoccluded(pages, identityRoots(), pyramid, cam, size, counts)
  assert.equal(counts.tested, 80)
  assert.equal(counts.tested - counts.rejected, kept.length)
  assert.ok(counts.oversized <= counts.tested)
  assert.ok(counts.rejectedTriangles <= counts.testedTriangles)
})
