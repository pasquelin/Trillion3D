// The engine's screen march as the reflection calls it, shipped WGSL run as JavaScript over depth
// images in an orthographic view: a hit on a surface's front, through a pixel's side, a gap, a depth
// thinner than a pixel, a pixel's plane; a ray behind a slab passes behind it; a miss in front of
// everything — each within the iterations of the reflections' cap.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_CONSTANTS } from './constants.ts'
import { falling, marcher } from './march.fixture.ts'

// Reversed depth: 1 at the near plane, 0 at infinity. The background reads 0. A surface is a slab
// of `REFLECTION_THICKNESS` pixels of footprint: in this view a pixel is 2 / H wide and so is its
// depth, 4 pixels are 0.125 of depth.
const W = 128,
  H = 64,
  SLAB = (REFLECTION_CONSTANTS.REFLECTION_THICKNESS * 2) / H

test('a ray stops where it crosses a depth, its own pixel never', () => {
  // A wall one pixel wide at x = 80 over a far floor; the ray crosses its depth in its pixel.
  const march = marcher(W, H, (x) => (x === 80 ? 0.5 : 0.1))
  const { o, d } = falling(20, 120, 30, 80, 0.5, 0.01)
  const { at, loads } = march.hit(o, d)
  assert.ok(at, 'hit')
  assert.ok(at[0] >= 80 && at[0] < 81, `on the wall's pixel: ${at[0]}`)
  // A ray that crosses the depth just before the wall enters the wall's slab through the side of
  // its pixel, and stops where it enters.
  const before = falling(20, 120, 30, 79.3, 0.5, 0.01)
  const earlier = march.hit(before.o, before.d)
  assert.ok(earlier.at && earlier.at[0] >= 80 && earlier.at[0] < 80.01, `${earlier.at?.[0]}`)
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

test('a ray across a wide image finds a far one-pixel depth within its iterations', () => {
  const march = marcher(640, 360, (x, y) => (x === 150 && y === 90 ? 0.5 : 0.05))
  const scale = 1.05
  const { at, steps, cap } = march.hit(
    [20.5, 10.5, 0.5 + 0.1 / scale],
    [(150.5 - 20.5) * scale, (90.5 - 10.5) * scale, -0.1],
  )
  assert.ok(at, 'hit')
  assert.deepEqual([Math.floor(at[0]), Math.floor(at[1])], [150, 90])
  assert.ok(steps <= cap, `${steps} iterations of ${cap}`)
})

test('a ray that skims a tilted plane for the whole image stays within its iterations, a miss', () => {
  // A plane tilted 0.0008 a row, the ray parallel to it a pixel and a half above: the cells of
  // the pyramid bound it away from the plane only where their tilt allows, and the pixels below
  // are crossed one by one — the floor level rising over the last iterations covers them.
  const slope = 0.0008
  const march = marcher(640, 360, (_, y) => 0.1 + slope * y)
  const { at, steps, cap } = march.hit([20.5, 100.5, 0.1 + slope * 102], [200, 0, 0])
  assert.equal(at, undefined)
  assert.ok(steps <= cap, `${steps} iterations of ${cap}`)
})

test('a ray in front of everything leaves the screen: a miss, within its iterations', () => {
  const march = marcher(W, H, (x) => (x < 64 ? 0.2 : 0.1))
  const { at, steps, cap } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(steps <= cap)
})

test('a ray meets a grazing plane in the half of its pixel past the centre, in whatever cell it enters', () => {
  // A ramp of 0.02 a row, past half a slab (0.0078): the far edge of the first row of an eight-row
  // cell lies past its centre's slab; the ray, level at 0.641, enters row 232 there.
  const tall = marcher(W, 1024, (_x, y) => (y < 200 ? 0 : y < 250 ? 0.02 * (y + 0.5 - 200) : 1))
  const { at } = tall.hit([64.5, 100.5, 0.641], [0, 300, 0])
  assert.ok(at && at[1] >= 232 && at[1] < 233, `in row 232: ${at?.[1]}`)
})

// The reference's walk (`hizTrace` `'reference'`, the default): the closest depth of each texel's
// centre, mip by mip, down to the full-resolution depth as the reflections' reference does, a hit
// the tile's depth flat (`screenMarchReference`).
const reference = (depth: (x: number, y: number) => number) => marcher(W, H, depth, () => 0, false)

test('the reference walk stops on the wall it falls onto, at the depth of its tile, flat', () => {
  // A wall four pixels wide over a far floor; the ray crosses its depth in the second pixel.
  const wall = (x: number) => (x >= 80 && x < 84 ? 0.5 : 0.1)
  const { o, d } = falling(20, 120, 30, 81, 0.5, 0.01)
  const { at, depth } = reference(wall).hit(o, d)
  assert.ok(at && at[0] >= 80 && at[0] < 82, `in the wall: ${at?.[0]}`)
  assert.equal(depth, 0.5, 'the tile’s depth, no slope')
})

test('the reference walk passes above a wall and behind a floor', () => {
  const march = reference((x) => (x >= 80 && x < 84 ? 0.5 : 0.1))
  assert.equal(march.hit([20.5, 30.5, 0.6], [100, 0, 0]).at, undefined, 'above the wall')
  // Behind a floor by more than the reference's thickness, a share of the floor's depth.
  const floor = reference(() => 0.5)
  assert.equal(floor.hit([20.5, 30.5, 0.0], [100, 0, 0]).at, undefined, 'behind the floor')
  // A share of the floor's distance from the eye's plane (depth 1 in the flat view: 0.5 m) behind
  // it, scaled by the projection (a range of 1 m is 100 cm, a hundredth): 0.5 · 0.005 / 100.
  assert.ok(floor.hit([20.5, 30.5, 0.5 - 0.00001], [100, 0, 0]).at, 'within its thickness')
  assert.equal(floor.hit([20.5, 30.5, 0.5 - 0.00005], [100, 0, 0]).at, undefined, 'past it')
})

test('the reference walk reads the full-resolution depth: a one-pixel wall is its own pixel', () => {
  const wall = (x: number) => (x === 81 ? 0.5 : 0.1)
  const { o, d } = falling(20, 120, 30, 80.5, 0.5, 0.01)
  // It falls through the empty pixel 80 onto the wall's pixel.
  const { at } = reference(wall).hit(o, d)
  assert.ok(at && at[0] >= 81 && at[0] < 82, `${at?.[0]}`)
})

test('the reference walk gives a ray up behind a thin surface at the surface, where the planes march passes behind it', () => {
  // The ray runs 0.3 behind a one-pixel pole (x = 50) over a far floor, and meets a wall at x = 100.
  const scene = (x: number) => (x === 50 ? 0.8 : x === 100 ? 0.5 + SLAB / 4 : 0.1)
  const march = marcher(W, H, scene)
  const ray: [number[], number[]] = [
    [20.5, 30.5, 0.5],
    [100, 0, 0],
  ]
  const plain = march.hit(...ray)
  assert.ok(plain.at && plain.at[0] >= 100 && plain.at[0] < 101, `${plain.at?.[0]}`)
  const strict = reference(scene).hit(...ray)
  assert.equal(strict.at, undefined)
  // It proved the ray in front of everything up to the pole's pixel, x = 50: t = 0.295.
  assert.ok(strict.above > 0.29 && strict.above < 0.3055, `${strict.above}`)
  assert.ok(strict.steps <= strict.cap)
})

test('the reference walk that spends its iterations meets nothing, and says how far it proved the ray clear', () => {
  const march = reference((x) => (x === 100 ? 0.5 : 0.1))
  const { o, d } = falling(20, 120, 30, 100, 0.5, 0.01)
  const whole = march.hit(o, d)
  assert.ok(whole.at && whole.at[0] >= 100 && whole.at[0] < 101, `${whole.at?.[0]}`)
  // A hit keeps the last point the ray passed above a surface before it, where a hit that is rejected resumes from.
  assert.ok(whole.above > 0 && whole.above <= (whole.at[0] - 20) / 100, `${whole.above}`)
  // Three iterations cover a few pixels of the way: no coarse cell stands in for the wall.
  const cut = march.hit(o, d, { cap: 3 })
  assert.equal(cut.at, undefined)
  assert.ok(cut.above > 0 && cut.above < (100 - 20) / 100, `${cut.above}`)
})

test('the reference walk of a ray in front of everything proves it clear to the end of the screen', () => {
  const march = reference((x) => (x < 64 ? 0.2 : 0.1))
  const { at, above, end } = march.hit([5.5, 5.5, 0.6], [200, 100, 0.2])
  assert.equal(at, undefined)
  assert.ok(Math.abs(above - end) < 1e-6, `${above} of ${end}`)
})

test('the reference walk of a ray the first step out of its texel carries to the end is rewound to its start: it proves nothing clear, where one that walks proves its way', () => {
  const march = reference(() => 0.1)
  // A ray of a third of a pixel ends inside the texel it starts in: the step out of it passes the end.
  const short = march.hit([20.5, 30.5, 0.6], [0.3, 0, 0])
  assert.equal(short.at, undefined)
  assert.equal(short.above, 0)
  // A ray that leaves its texel with ground to cover is clear to its end.
  const long = march.hit([20.5, 30.5, 0.6], [30, 0, 0])
  assert.equal(long.at, undefined)
  assert.ok(Math.abs(long.above - long.end) < 1e-6, `${long.above} of ${long.end}`)
})
