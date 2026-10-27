// Batch 3, camera.ts: the orthographic planes — the correction that moves a camera's origin onto its
// near plane (`correctOrthoPlanes`) and the automatic range worked out from the picture
// (`autoOrthoPlanes`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { IDENTITY_MATRIX4 } from '../matrix/matrix4.ts'
import { autoOrthoPlanes, correctOrthoPlanes } from './camera.ts'

const isNear = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol

test('correctOrthoPlanes: no target — the origin moves by the near plane and the height, the range starts at the near plane', () => {
  const world = Float64Array.from(IDENTITY_MATRIX4)
  world.set([2, 3, 1], 12)
  const range = { near: 0.5, far: 100.5 }
  // forward (0.6, −0.8, 0): the height is |min(3, 10)| · 0.8 = 2.4, the move forward · 2.9.
  correctOrthoPlanes(world, [0.6, -0.8, 0], new Float64Array(3), range, 10, {
    nearPlane: 0,
    heightAsViewTarget: true,
  })
  const expected = [2 + 1.74, 3 - 2.32, 1]
  assert.ok(
    expected.every((v, k) => isNear(world[12 + k], v)),
    `${world.slice(12, 15)}`,
  )
  assert.deepEqual(range, { near: 0, far: 100 })
})

test('correctOrthoPlanes: the height is the lesser of the origin’s and the half width, unsigned; off, it is the near plane alone', () => {
  const planes = { nearPlane: 1, heightAsViewTarget: true }
  const down = [0, -1, 0]
  const high = Float64Array.from(IDENTITY_MATRIX4)
  high.set([0, 10, 0], 12)
  correctOrthoPlanes(high, down, new Float64Array(3), { near: 0.5, far: 10.5 }, 4, planes)
  assert.ok(isNear(high[13], 10 - 4.5), 'capped at the half width')
  const below = Float64Array.from(IDENTITY_MATRIX4)
  below.set([0, -3, 0], 12)
  correctOrthoPlanes(below, down, new Float64Array(3), { near: 0.5, far: 10.5 }, 4, planes)
  assert.ok(isNear(below[13], -3 - 3.5), 'a height below the ground counts without its sign')
  const flat = Float64Array.from(IDENTITY_MATRIX4)
  flat.set([0, 10, 0], 12)
  const range = { near: 0.5, far: 10.5 }
  correctOrthoPlanes(flat, down, new Float64Array(3), range, 4, {
    ...planes,
    heightAsViewTarget: false,
  })
  assert.ok(isNear(flat[13], 9.5))
  assert.deepEqual(range, { near: 1, far: 11 })
})

test('correctOrthoPlanes: with a target the origin goes onto it, moved by the near plane, and the target keeps its place', () => {
  const world = Float64Array.from(IDENTITY_MATRIX4)
  world.set([0, 10, 0], 12)
  const target = Float64Array.of(0, -10, 0)
  const range = { near: 0.5, far: 100.5 }
  correctOrthoPlanes(world, [0, -1, 0], target, range, 4, {
    nearPlane: 0,
    heightAsViewTarget: true,
  })
  // origin = (0, 10, 0) + (0, −10, 0) + (0, −1, 0) · 0.5; the target (0, 0, 0) is 0.5 above it.
  assert.deepEqual([...world.slice(12, 15)], [0, -0.5, 0])
  assert.deepEqual([...target], [0, 0.5, 0])
  assert.deepEqual(range, { near: 0, far: 100 })
})

// `autoOrthoPlanes`: the numbers are worked by hand from the steps of the reference's automatic range, in centimetres, the unit of its constants, with the true forward
// for its `ViewForward` (it reads the third column of the camera's rotation matrix, the camera's up).
const AUTO = { halfFloatDepth: true, scaleUnits: true, depthScale: -1, shift: 0 }
/** A square box 800 wide, looked at straight down, no point framed, a picture 1000 rows high. */
const DOWN = {
  forwardUp: -1,
  width: 800,
  aspect: 1,
  targetDistance: 0,
  viewportWidth: 1000,
  viewportHeight: 1000,
}
const autoRange = (view = {}, settings = {}) => {
  const range = { near: NaN, far: NaN }
  autoOrthoPlanes(range, { ...DOWN, ...view }, { ...AUTO, ...settings })
  return [range.near, range.far]
}
const nearly = (actual: number[], expected: number[]) =>
  expected.forEach((v, k) => {
    const tolerance = 1e-6 * Math.max(1, Math.abs(v))
    assert.ok(isNear(actual[k], v, tolerance), `${k}: ${actual[k]} ≠ ${v}`)
  })

test('autoOrthoPlanes: straight down, a pixel finer than a centimetre leaves the far plane at the half float', () => {
  // pixel ⌊800 / 1000⌋ = 0, log2 0 = −∞; near 800 · (1 − 1 / 0.707107) = −331.3705.
  nearly(autoRange(), [-331.37049979706035, 65504])
  // The arm, 5000 · cosine 1, lengthens the near plane; the far plane stays.
  nearly(autoRange({ targetDistance: 5000 }), [-5331.37049979706, 65504])
  // A wider box at the same height: the larger side sets the near plane.
  const wide = { width: 1600, aspect: 2, viewportWidth: 1920, viewportHeight: 1080 }
  nearly(autoRange(wide), [-662.7409995941207, 65504])
})

test('autoOrthoPlanes: the far plane follows the logarithm of the pixel, or the pixel itself, held to the world', () => {
  const coarse = { viewportWidth: 1, viewportHeight: 1 }
  // pixel 800, log2 800 = 9.6439: 65504 · 9.6439.
  nearly(autoRange(coarse), [-331.37049979706035, 631711.1558550036])
  // Without the logarithm 800 · 65504 is held to 2097152 + near.
  nearly(autoRange(coarse, { scaleUnits: false }), [-331.37049979706035, 2096820.6295002028])
})

test('autoOrthoPlanes: without the half float the far plane is the height over the cosine, held to the world', () => {
  const level = { forwardUp: 0, viewportWidth: 0, viewportHeight: 0 }
  // Level: cosine 0 reads 0.00001; near 800 · max(0.707107 − 1, −0.5) = −234.3144; far 2097152 + near.
  nearly(autoRange(level, { halfFloatDepth: false }), [-234.3144, 2096917.6856])
  // At 45 degrees: 800 / 0.7071 = 1131.37; near 800 · max(0.707107 − 1.414213, −0.5) = −400.
  const tilted = { forwardUp: -Math.SQRT1_2, viewportWidth: 0, viewportHeight: 0 }
  nearly(autoRange(tilted, { halfFloatDepth: false }), [-400, 1131.3708498984759])
  // A picture with no area is no picture to scale by, the half float on or not.
  const flat = { viewportWidth: 0 }
  nearly(autoRange(flat), autoRange(flat, { halfFloatDepth: false }))
})

test('autoOrthoPlanes: the depth scale lowers the half float, to no less than 1; the shift moves both planes', () => {
  const small = { viewportWidth: 100, viewportHeight: 100 }
  // Depth 10000, pixel 8, log2 8 = 3: 30000; both + 100.
  nearly(autoRange(small, { depthScale: 10000, shift: 100 }), [-231.37049979706035, 30100])
  // A depth scale past the half float is no more than it.
  nearly(autoRange(small, { depthScale: 1e9 }), [-331.37049979706035, 196512])
  nearly(autoRange({}, { shift: -50 }), [-381.37049979706035, 65454])
})

test('autoOrthoPlanes, then correctOrthoPlanes: the order of the reference, the range of the first read by the second', () => {
  const range = { near: NaN, far: NaN }
  autoOrthoPlanes(range, { ...DOWN, targetDistance: 5000 }, AUTO)
  const world = Float64Array.from(IDENTITY_MATRIX4)
  world.set([0, 5000, 0], 12)
  const target = Float64Array.of(0, -5000, 0)
  const planes = { nearPlane: 0, heightAsViewTarget: true }
  correctOrthoPlanes(world, [0, -1, 0], target, range, 400, planes)
  // origin 5000 − 5000 + (−1) · (−5331.3705) = 5331.3705; the target 5331.3705 below it; the range
  // keeps its length 65504 + 5331.3705.
  nearly([...world.slice(12, 15)], [0, 5331.37049979706, 0])
  nearly([...target], [0, -5331.37049979706, 0])
  nearly([range.near, range.far], [0, 70835.37049979706])
})
