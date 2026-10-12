// The reflection's hierarchical march, shipped WGSL run as JavaScript (`scene.fixture.ts`) over
// depth images in an orthographic view: a hit where the ray crosses a surface's front, or enters its
// slab through the side of a pixel, through a gap, on a depth thinner than a pixel, on a pixel's
// plane, never on the pixel centres a ray skims in front of, never in the pixel it leaves; a ray
// behind a slab passes behind it and goes on to what lies past; a miss in front of everything — each
// within its bound, the iterations of the screen distance covered (`reflectionBudget`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { reflectionConstant } from './constants.fixture.ts'
import { falling, marcher } from './march.fixture.ts'

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0. A surface is a slab
// of `REFLECTION_THICKNESS` pixels of footprint: in this view a pixel is 2 / H wide and so is its
// depth, 4 pixels are 0.125 of depth.
const W = 128,
  H = 64,
  SLAB = (reflectionConstant('REFLECTION_THICKNESS') * 2) / H

test('a ray stops where it crosses a depth, its own pixel never', () => {
  // A wall one pixel wide at x = 80 over a far floor; the ray crosses its depth in its pixel.
  const march = marcher(W, H, (x) => (x === 80 ? 0.5 : 0.1))
  const { o, d } = falling(20, 120, 30, 80, 0.5, 0.01)
  const { at, loads, into } = march.hit(o, d)
  assert.ok(at, 'hit')
  assert.ok(at[0] >= 80 && at[0] < 81, `on the wall's pixel: ${at[0]}`)
  assert.equal(into, 0, 'from its front')
  // A ray that crosses the depth just before the wall enters the wall's slab through the side of
  // its pixel, and stops where it enters.
  const before = falling(20, 120, 30, 79.3, 0.5, 0.01)
  const earlier = march.hit(before.o, before.d)
  assert.ok(earlier.at && earlier.at[0] >= 80 && earlier.at[0] < 80.01, `${earlier.at?.[0]}`)
  assert.ok(earlier.into > 0 && earlier.into < 0.1, `${earlier.into} into the slab`)
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

test('a ray behind a slab passes behind it, and meets what lies within its thickness past it', () => {
  // The first wall stands 0.3 in front of the ray, thicker than its slab: the ray is behind it.
  const behind = (second: number) =>
    marcher(W, H, (x) => (x === 60 ? 0.8 : x === 90 ? second : 0.1))
  assert.ok(0.8 - 0.5 > SLAB)
  // The wall past it is behind the ray too: nothing in the way.
  assert.equal(behind(0.3).hit([20.5, 30.5, 0.5], [100, 0, 0]).at, undefined)
  // The wall past it stands inside the ray's thickness: the ray enters its slab through the side.
  const inside = behind(0.5 + SLAB / 2).hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(inside.at && inside.at[0] >= 90 && inside.at[0] < 90.01, `${inside.at?.[0]}`)
  assert.ok(Math.abs(inside.into - 0.5) < 1e-3, `${inside.into} into the slab`)
  // One whose slab the ray is past is no hit.
  assert.equal(behind(0.5 + 1.2 * SLAB).hit([20.5, 30.5, 0.5], [100, 0, 0]).at, undefined)
})

test('a pole and a fence in front of a wall let the ray through, a box deeper than the slab stops it', () => {
  // The ray runs a hair behind the depth of a wall, 0.3 behind a one-pixel pole (x = 50) and a
  // fence of four pixels (x = 60..63); the wall stands at x = 100, within the ray's thickness.
  const scene = (box: boolean) =>
    marcher(W, H, (x) => {
      if (x === 50 || (x >= 60 && x < 64)) return 0.8
      if (box && x >= 70 && x < 90) return 0.75
      return x === 100 ? 0.5 + SLAB / 4 : 0.1
    })
  const through = scene(false).hit([20.5, 30.5, 0.5], [100, 0, 0])
  assert.ok(through.at && through.at[0] >= 100 && through.at[0] < 101, `${through.at?.[0]}`)
  // A box whose front lies within the ray's thickness (0.25 in front of it, deeper than the slab,
  // 20 pixels of it): the ray is behind the slab of every pixel of its front, and passes behind it
  // too — the slab is the surface's thickness, not the volume's.
  assert.ok(0.75 - 0.5 > SLAB)
  assert.ok(scene(true).hit([20.5, 30.5, 0.5], [100, 0, 0]).at)
  // The same box in front of the ray's own depth, crossed from its front, stops it.
  const front = scene(true).hit([20.5, 30.5, 1.2], [100, 0, -0.8])
  assert.ok(front.at && front.at[0] >= 76 && front.at[0] < 77, `${front.at?.[0]}`)
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

test('a ray across a wide image finds a far one-pixel depth within its iteration bound', () => {
  const march = marcher(640, 360, (x, y) => (x === 150 && y === 90 ? 0.5 : 0.05))
  const scale = 1.05
  const { at, loads, bound } = march.hit(
    [20.5, 10.5, 0.5 + 0.1 / scale],
    [(150.5 - 20.5) * scale, (90.5 - 10.5) * scale, -0.1],
  )
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [150, 90])
  assert.ok(loads <= bound, `${loads} reads of ${bound}`)
})

test('a ray that skims a tilted plane for the whole image stays within its bound, a miss', () => {
  // A plane tilted 0.0008 a row, the ray parallel to it a pixel and a half above: the cells of
  // the pyramid bound it away from the plane only where their tilt allows, and the pixels below
  // are crossed one by one — the bound of the screen distance covers them.
  const slope = 0.0008
  const march = marcher(640, 360, (_, y) => 0.1 + slope * y)
  const { at, loads, bound } = march.hit([20.5, 100.5, 0.1 + slope * 102], [200, 0, 0])
  assert.equal(at, undefined)
  assert.ok(loads <= bound, `${loads} reads of ${bound}`)
})

test('a ray in front of everything leaves the screen: a miss, within its bound', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, loads, bound } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(loads <= bound)
})
