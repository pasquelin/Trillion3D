// The reflection's hierarchical march, shipped WGSL run as JavaScript (`scene.fixture.ts`) over
// depth images in an orthographic view: a hit where a depth stands, through a gap, on a depth
// thinner than a pixel, on a pixel's plane, never on the pixel centres a ray skims in front of, a
// stop behind a depth it passes behind, a miss in front of everything — each within its bound.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_ITERATIONS, REFLECTION_THICKNESS } from './wgsl.ts'
import { reflectionRunner, viewOf } from './scene.fixture.ts'
import { depthField } from './depthField.fixture.ts'

/** An orthographic view of `width × height` pixels whose world is its NDC: depth along +z, toward
 *  the eye, a thickness of `2 · REFLECTION_THICKNESS` in depth. */
function flatView(width: number, height: number) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return viewOf(identity, identity, [0, 0, 1, 0], [width, height], 2 / height)
}
const SLAB = 2 * REFLECTION_THICKNESS

/** The shipped march over the depth image `depth`, `width × height`. */
function marcher(width: number, height: number, depth: (x: number, y: number) => number) {
  const image = Float64Array.from({ length: width * height }, (_, i) =>
    depth(i % width, Math.floor(i / width)),
  )
  const run = reflectionRunner(depthField(width, height, image), flatView(width, height))
  const size = [width, height]
  return {
    /** Where the ray from `o` along `d` stops on the screen, or undefined: a miss. */
    hit(o: number[], d: number[]) {
      run.counter.loads = 0
      const { t, plane } = run.reflectionMarch(
        o,
        d,
        run.reflectionScreenEnd(o.slice(0, 2), d.slice(0, 2), size),
      )
      const at = t < 0 ? undefined : o.map((x, k) => x + d[k] * t)
      return { at, depth: plane[0], loads: run.counter.loads }
    },
  }
}

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0.
const W = 128,
  H = 64
/** A depth the ray at 0.5 lies behind, within the thickness. */
const NEAR_WALL = 0.5 + SLAB / 2

test('a ray stops at the first depth it lies behind, its own pixel never', () => {
  // A wall one pixel wide at x = 80 over a far floor; the ray at a constant depth of 0.5.
  const march = marcher(W, H, (x) => (x === 80 ? NEAR_WALL : 0.1))
  const { at, loads } = march.hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(at, 'hit')
  assert.ok(at[0] >= 80 && at[0] < 81, `on the wall's pixel: ${at[0]}`)
  // A ray leaving its own surface: the origin's pixel is never its hit.
  const own = marcher(W, H, (x) => (x === 20 ? 0.5 : 0.1)).hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.equal(own.at, undefined)
  // Hierarchical: far fewer reads than the 60 pixels crossed.
  assert.ok(loads < 40, `${loads} reads`)
})

test('a depth thinner than a pixel stops a ray at every slope, coarse levels never skip it', () => {
  for (const [wx, wy] of [
    [80, 31],
    [64, 32],
    [63, 33],
  ]) {
    const march = marcher(W, H, (x, y) => (x === wx && y === wy ? NEAR_WALL : 0))
    const o = [wx + 0.5 - 50, wy + 0.5 - 20, 0.5]
    const { at } = march.hit(o, [100, 40, 0])
    assert.ok(at, `hit ${wx},${wy}`)
    assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [wx, wy])
  }
})

test('a ray passes a one-pixel gap in a wall and stops at the depth behind it', () => {
  const march = marcher(W, H, (x, y) => {
    if (x === 70 && y !== 30) return NEAR_WALL
    return x === 100 ? NEAR_WALL : 0.1
  })
  const { at } = march.hit([10.5, 30.5, 0.5], [110, 0, 0])
  assert.ok(at)
  assert.ok(at[0] >= 100 && at[0] < 101, `through the gap: ${at[0]}`)
  const below = march.hit([10.5, 31.5, 0.5], [110, 0, 0])
  assert.ok(below.at && below.at[0] >= 70 && below.at[0] < 71)
})

test('a ray behind a depth stops there, past the thickness: no hit on the depth behind it', () => {
  // The first wall stands 0.3 in front of the ray, over four thicknesses: the ray stops behind it, a
  // gap the thickness test refuses, and never reaches the wall behind.
  const march = marcher(W, H, (x) => (x === 60 ? 0.8 : x === 90 ? NEAR_WALL : 0.1))
  const { at, depth } = march.hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(at && at[0] >= 60 && at[0] < 61, `behind the first wall: ${at?.[0]}`)
  assert.ok(depth - at[2] > 4 * SLAB)
})

test('a ray moving away meets a depth where its own depth reaches it', () => {
  const march = marcher(W, H, () => 0.3)
  const { at } = march.hit([10.5, 20.5, 0.9], [100, 0, -0.9])
  assert.ok(at)
  // Where 0.9 - 0.9·t = 0.3: t = 2/3, x = 10.5 + 66.7.
  assert.ok(Math.abs(at[0] - (10.5 + (100 * 2) / 3)) < 1, `${at[0]}`)
  assert.ok(Math.abs(at[2] - 0.3) < 1e-6)
})

test('a ray skimming a surface seen edge-on never stops on the centres it passes behind', () => {
  // A plane whose depth climbs 0.004 a row, its pixels holding their centres' depth; a ray along
  // a row near its top edge, a hair in front of the plane there but behind every centre.
  const slope = 0.004
  const plane = (y: number) => 0.2 + slope * y
  const march = marcher(W, H, (_, y) => plane(y + 0.5))
  const y = 40.1,
    z = plane(y) + 1e-4
  assert.ok(z < plane(40.5), 'behind the row centres')
  const { at } = march.hit([5.5, y, z], [200, 0, 0])
  assert.equal(at, undefined, `no hit: ${at}`)
  // The same ray a hair behind the plane meets it at once.
  const behind = march.hit([5.5, y, plane(y) - 1e-4], [200, 0, 0])
  assert.ok(behind.at && behind.at[0] < 8, `${behind.at}`)
})

test('a ray across a wide image finds a far one-pixel depth within its step bound', () => {
  const march = marcher(640, 360, (x, y) => (x === 600 && y === 330 ? NEAR_WALL : 0.05))
  const o = [20.5, 10.5, 0.5]
  const { at, loads } = march.hit(o, [(600.5 - 20.5) * 1.05, (330.5 - 10.5) * 1.05, 0])
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [600, 330])
  assert.ok(loads <= REFLECTION_ITERATIONS, `${loads} reads`)
})

test('a ray in front of everything leaves the screen: a miss, within its step bound', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, loads } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(loads <= REFLECTION_ITERATIONS)
})
