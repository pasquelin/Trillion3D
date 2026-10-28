// The sun's distance-field shadow: where its cascade lies, and the uniform that places it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { cascadeBounds } from './bounds.ts'
import {
  DFSH_CUBE,
  DFSH_FLAG,
  DFSH_PARAMS,
  DFSH_PARAMS_STRIDE,
  DFSH_STEPS,
  shadowTileSide,
} from './layout.ts'
import { boundsOf, writeDfshParams } from './params.ts'
import { SETTINGS, SUN, camera, dot, near, placed } from './boundsParams.fixture.ts'

test('the cube a mesh is drawn as has outward faces, each corner on three', () => {
  assert.equal(DFSH_CUBE.length, 36)
  const corner = (c: number) => [c & 1 ? 1 : -1, c & 2 ? 1 : -1, c & 4 ? 1 : -1]
  for (let t = 0; t < 12; t++) {
    const [a, b, c] = DFSH_CUBE.slice(3 * t, 3 * t + 3).map(corner)
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const centroid = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3)
    assert.ok(dot(normal, centroid) > 0, `triangle ${t} turns its face out`)
  }
  for (let c = 0; c < 8; c++)
    assert.equal(DFSH_CUBE.filter((x) => x === c).length >= 3, true, `corner ${c} is on faces`)
})

test('the grid of tiles is a radius over the tile and one, held to 256 and rounded up to 64', () => {
  assert.equal(shadowTileSide(5000, 200), 64)
  assert.equal(shadowTileSide(20000, 200), 128)
  assert.equal(shadowTileSide(50000, 200), 256)
  assert.equal(shadowTileSide(500000, 200), 256)
  assert.equal(shadowTileSide(10, 200), 64)
})

test('the cascade lies in the slice of the view between its depths: the sphere holds it, the hull is open toward the light', () => {
  // A sun a little off the vertical: one exactly over a level view leaves the side walls edge-on.
  const toLight = [0.2, 0.96, 0.19]
  const length = Math.hypot(...toLight)
  const light = toLight.map((x) => x / length)
  const b = cascadeBounds(camera(), 100, 512, light)
  assert.ok(b.planeCount >= 4 && b.planeCount <= 12, `${b.planeCount} planes`)
  // Corners of the slice, centimetres from the eye: at depth d the half widths are 2d across, d up.
  const slice = [100, 512].flatMap((d) =>
    [-1, 1].flatMap((x) => [-1, 1].map((y) => [x * 2 * d * 100, y * d * 100, -d * 100])),
  )
  for (const c of slice)
    assert.ok(
      Math.hypot(c[0] - b.centre[0], c[1] - b.centre[1], c[2] - b.centre[2]) <= b.radius,
      `a corner is in the sphere`,
    )
  const outside = (p: number[]) => {
    for (let k = 0; k < b.planeCount; k++) {
      const plane = b.planes.subarray(4 * k, 4 * k + 4)
      if (dot(plane, p) - plane[3] > 1e-3) return true
    }
    return false
  }
  assert.equal(outside([0, 0, -30000]), false, 'the middle of the slice')
  assert.equal(
    outside([5000, 30000, -30000]),
    false,
    'above it, toward the light: the hull is open there',
  )
  assert.equal(outside([0, -60000, -30000]), true, 'below it, under the slice')
  assert.equal(outside([200000, 0, -30000]), true, 'far to the side')
  assert.equal(outside([0, 0, -60000]), true, 'past its far end')
  assert.equal(outside([0, 0, -2000]), true, 'before its near end')
  // The light's right and up with its direction are an orthonormal frame, right-handed.
  near(dot(b.right, b.up), 0, 'right ⟂ up')
  near(dot(b.right, light), 0, 'right ⟂ light')
  near(dot(b.up, light), 0, 'up ⟂ light')
  const across = [
    b.right[1] * b.up[2] - b.right[2] * b.up[1],
    b.right[2] * b.up[0] - b.right[0] * b.up[2],
    b.right[0] * b.up[1] - b.right[1] * b.up[0],
  ]
  near(dot(across, light), 1, 'right × up is the light’s direction: a right-handed frame')
})

test('the uniform of a light places the shadow space, the eye, the trace and the grid', () => {
  const image = camera([1000.5, 3, -2000.25])
  const bounds = boundsOf(image, SUN)
  const floats = new Float32Array((2 * DFSH_PARAMS_STRIDE) / 4)
  const words = new Uint32Array(floats.buffer)
  writeDfshParams(floats, words, 1, { image, light: SUN, bounds, layer: 1 }, SETTINGS, {
    objects: 99,
  })
  const at = (DFSH_PARAMS_STRIDE / 4) as number
  const field = (name: keyof typeof DFSH_PARAMS.at, k = 0) => at + DFSH_PARAMS.at[name] + k
  // The unprojection takes a device position and depth to the position from the eye, in centimetres.
  const apply = (m: number, p: number[]) => {
    const h = [0, 1, 2, 3].map((r) =>
      [0, 1, 2, 3].reduce((s, c) => s + floats[m + c * 4 + r] * p[c], 0),
    )
    return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
  }
  const depth = 250
  const along = apply(field('unproject'), [0, 0, image.near / depth, 1])
  near(along[0], 0, 'on the axis', 1e-3)
  near(along[2], -depth * 100, 'at the depth, from the eye', 1e-3)
  const corner = apply(field('unproject'), [1, 1, image.near / depth, 1])
  near(corner[0], 2 * depth * 100, 'the field is 90 degrees across', 1e-3)
  near(corner[1], depth * 100, 'and half that across the height', 1e-3)
  // The shadow space: the sphere's centre in the middle of the depth, at most a snap step from the
  // origin across the light, the depth toward the light the greater, over twice the range.
  const step = (2 * 4) / SETTINGS.snapTexels
  const centre = apply(field('toShadow'), [...bounds.centre, 1])
  assert.ok(Math.abs(centre[0]) < step && Math.abs(centre[1]) < step, `${centre}`)
  near(centre[2], 0.5, 'centre z', 1e-5)
  const range = Math.max(bounds.roundedRadius, 5000)
  const up = apply(field('toShadow'), [
    ...bounds.centre.map((x, k) => x + SUN.toLight[k] * bounds.radius),
    1,
  ])
  near(up[2], 0.5 + bounds.radius / (2 * range), 'a radius toward the light', 1e-5)
  // The eye as a pair of floats, the trace's steps by the quality.
  for (let k = 0; k < 3; k++)
    near(floats[field('eyeHigh', k)] + floats[field('eyeLow', k)], image.eye[k] * 100, 'eye', 1e-7)
  assert.equal(floats[field('trace', 2)], DFSH_STEPS[3])
  assert.equal(floats[field('trace', 3)], 1, 'the quality 3 lets a thin surface transmit')
  near(floats[field('trace')], 10000, 'trace distance in centimetres')
  near(floats[field('light', 3)], Math.tan(2 * 0.5357 * DEG2RAD), 'the sun’s tangent', 1e-6)
  near(floats[field('range')], 73 * 100, 'nearest depth, centimetres')
  near(floats[field('range', 1)], 512 * 100, 'farthest depth')
  // The grid of tiles, its room, the meshes, the cube.
  const side = shadowTileSide(bounds.radius, 200)
  assert.equal(words[field('tiles')], side)
  assert.equal(words[field('tiles', 1)], 128 * side * side)
  assert.equal(words[field('tiles', 2)], 99)
  assert.equal(
    words[field('tiles', 3)],
    128,
    'the place of a tile when the lists are not compacted',
  )
  assert.equal(words[field('counts', 1)], 36)
  assert.equal(words[field('counts', 3)], DFSH_FLAG.compactTiles, 'the lists are compacted')
  assert.deepEqual([...words.subarray(field('view'), field('view') + 4)], [1000, 500, 2, 1])
  near(floats[field('expand')], (1.414 * bounds.radius) / side, 'a tile’s half diagonal')
  // The widest cone across the shadow space: 100 centimetres by the largest scale the matrix gives an
  // axis — for a sun straight up, the greater of 1 over the rounded radius and 1 over twice the range.
  near(
    floats[field('expand', 1)],
    100 * Math.max(1 / bounds.roundedRadius, 1 / (2 * range)),
    'the widest cone across the shadow space',
  )
  // The view's right, up and forward, from the camera's world matrix looking down its -z.
  assert.deepEqual(
    [0, 1, 2].map((k) => floats[field('axes', k)]),
    [1, 0, 0],
  )
  assert.deepEqual(
    [0, 1, 2].map((k) => floats[field('axes', 4 + k)]),
    [0, 1, 0],
  )
  assert.deepEqual(
    [0, 1, 2].map((k) => floats[field('axes', 8 + k)]),
    [0, 0, -1],
  )
  // The block of light 0 is another, untouched.
  assert.equal(floats[0], 0)
})

test('the tangent of a sun’s disk is held between 0.001 and 5 degrees of its apex angle', () => {
  const tangent = (angularRadius: number) =>
    placed([0, 0, 0], { ...SUN, angularRadius }).floats[DFSH_PARAMS.at.light + 3]
  near(tangent(0.2678 * DEG2RAD), Math.tan(0.5356 * DEG2RAD), 'a sun’s own', 1e-4)
  near(tangent(0), Math.tan(0.001 * DEG2RAD), 'a point source')
  near(tangent(1), Math.tan(5 * DEG2RAD), 'a large disk')
})

test('the thin transmission is on from the quality 3 alone, and only where the pass asks for it', () => {
  const transmits = (quality: number, transmission = true) =>
    placed([0, 0, 0], SUN, { ...SETTINGS, quality, transmission }).floats[DFSH_PARAMS.at.trace + 3]
  assert.deepEqual(
    [1, 2, 3].map((q) => transmits(q)),
    [0, 0, 1],
  )
  assert.equal(transmits(3, false), 0, 'a pass over the water’s depth has none')
})
