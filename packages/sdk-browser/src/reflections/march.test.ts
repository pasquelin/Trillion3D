// The reflection's hierarchical march, shipped WGSL run as JavaScript (`scene.fixture.ts`) over
// depth images in an orthographic view: a hit where the ray crosses a depth, through a gap, on a
// depth thinner than a pixel, on a pixel's plane, never on the pixel centres a ray skims in front
// of, never in the pixel it leaves, a miss behind a depth it never crossed or in front of
// everything — each within its bound.
import test from 'node:test'
import assert from 'node:assert/strict'
import { reflectionConstant } from './shaderParts.fixture.ts'
import { reflectionRunner, viewOf } from './scene.fixture.ts'
import { depthField } from './depthField.fixture.ts'

/** An orthographic view of `width × height` pixels whose world is its NDC: depth along +z, toward
 *  the eye. */
function flatView(width: number, height: number) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  return viewOf(identity, identity, [0, 0, 1, 0], [width, height], 2 / height)
}

/** The shipped march over the depth image `depth`, `width × height`. */
function marcher(width: number, height: number, depth: (x: number, y: number) => number) {
  const image = Float64Array.from({ length: width * height }, (_, i) =>
    depth(i % width, Math.floor(i / width)),
  )
  const field = depthField(width, height, image)
  const run = reflectionRunner(field, flatView(width, height))
  const size = [width, height]
  return {
    /** The iterations the march may take over this image. */
    bound: reflectionConstant('REFLECTION_ITERATIONS_PER_LEVEL') * field.levels.level[0][3],
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

/** The ray from the centre of pixel `(x0, y)` to the centre of `(x1, y)`, falling `fall` a pixel so
 *  that it passes through the depth `z` over the pixel `x`, at its centre. */
const falling = (x0: number, x1: number, y: number, x: number, z: number, fall: number) => ({
  o: [x0 + 0.5, y + 0.5, z + fall * (x - x0)],
  d: [x1 - x0, 0, -fall * (x1 - x0)],
})

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0.
const W = 128,
  H = 64

test('a ray stops where it crosses a depth, its own pixel never', () => {
  // A wall one pixel wide at x = 80 over a far floor; the ray crosses its depth in its pixel.
  const march = marcher(W, H, (x) => (x === 80 ? 0.5 : 0.1))
  const { o, d } = falling(20, 120, 30, 80, 0.5, 0.01)
  const { at, loads } = march.hit(o, d)
  assert.ok(at, 'hit')
  assert.ok(at[0] >= 80 && at[0] < 81, `on the wall's pixel: ${at[0]}`)
  // A ray that crossed the depth in the pixel before the wall stops where it crossed it.
  const before = falling(20, 120, 30, 79.3, 0.5, 0.01)
  const earlier = march.hit(before.o, before.d)
  assert.ok(earlier.at && earlier.at[0] >= 79 && earlier.at[0] < 80, `${earlier.at?.[0]}`)
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
    const march = marcher(W, H, (x, y) => (x === wx && y === wy ? 0.5 : 0))
    // Through the wall's centre at half the ray, falling through its depth there.
    const { at } = march.hit([wx + 0.5 - 50, wy + 0.5 - 20, 0.6], [100, 40, -0.2])
    assert.ok(at, `hit ${wx},${wy}`)
    assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [wx, wy])
  }
})

test('a ray passes a one-pixel gap in a wall and stops at the depth behind it', () => {
  const march = marcher(W, H, (x, y) => {
    if (x === 70 && y !== 30) return 0.5
    return x === 100 ? 0.5 : 0.1
  })
  const through = falling(10, 120, 30, 100, 0.5, 0.01)
  const { at } = march.hit(through.o, through.d)
  assert.ok(at)
  assert.ok(at[0] >= 100 && at[0] < 101, `through the gap: ${at[0]}`)
  const below = falling(10, 120, 31, 70, 0.5, 0.01)
  const hit = march.hit(below.o, below.d)
  assert.ok(hit.at && hit.at[0] >= 70 && hit.at[0] < 71)
})

test('a ray behind a depth it never crossed passes behind it: a miss, none on the depth behind', () => {
  // The first wall stands 0.3 in front of the ray; the wall behind it is at the ray's depth.
  const march = marcher(W, H, (x) => (x === 60 ? 0.8 : x === 90 ? 0.5 : 0.1))
  assert.equal(march.hit([20.5, 30.5, 0.5], [100, 0, 0]).at, undefined)
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
  assert.equal(march.hit([5.5, y, z], [100, 0, 0]).at, undefined)
  // Falling onto the plane, it stops where it meets it.
  const { at } = march.hit([5.5, y, z], [100, 0, -0.01])
  assert.ok(at && Math.abs(at[2] - plane(y)) < 1e-6, `${at}`)
})

test('a ray across a wide image finds a far one-pixel depth within its step bound', () => {
  const march = marcher(640, 360, (x, y) => (x === 600 && y === 330 ? 0.5 : 0.05))
  const scale = 1.05
  const { at, loads } = march.hit(
    [20.5, 10.5, 0.5 + 0.1 / scale],
    [(600.5 - 20.5) * scale, (330.5 - 10.5) * scale, -0.1],
  )
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [600, 330])
  assert.ok(loads <= march.bound, `${loads} reads`)
})

test('a ray that skims a plane for the whole image runs out of its bound: a miss', () => {
  // A plane tilted 0.0008 a row, the ray parallel to it a pixel and a half above: no cell of the
  // pyramid bounds it away from the plane (they keep the farthest height, not the tilt).
  const slope = 0.0008
  const march = marcher(640, 360, (_, y) => 0.1 + slope * y)
  const { at, loads } = march.hit([20.5, 100.5, 0.1 + slope * 102], [500, 0, 0])
  assert.equal(at, undefined)
  assert.equal(loads, march.bound)
})

test('a ray in front of everything leaves the screen: a miss, within its step bound', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, loads } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(loads <= march.bound)
})
