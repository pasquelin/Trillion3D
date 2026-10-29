// The suns' mesh lists: where a volume lies, and the uniform that places it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { boxBounds } from './bounds.ts'
import { DFSH_CUBE, DFSH_FLAG, DFSH_PARAMS, DFSH_STEPS, shadowTileSide } from './layout.ts'
import { SETTINGS, dot, near, placed } from './boundsParams.fixture.ts'

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

test('the volume holds the cube: the sphere holds it, the hull is open toward the light', () => {
  // A sun a little off the vertical: one exactly over a level cube leaves the side walls edge-on.
  const toLight = [0.2, 0.96, 0.19]
  const length = Math.hypot(...toLight)
  const light = toLight.map((x) => x / length)
  const b = boxBounds([0, 0, 0], 100, light)
  assert.ok(b.planeCount >= 4 && b.planeCount <= 12, `${b.planeCount} planes`)
  // Corners of the cube, centimetres from the eye.
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        assert.ok(
          Math.hypot(x * 10000 - b.centre[0], y * 10000 - b.centre[1], z * 10000 - b.centre[2]) <=
            b.radius * (1 + 1e-6),
          `a corner is in the sphere`,
        )
  const outside = (p: number[]) => {
    for (let k = 0; k < b.planeCount; k++) {
      const plane = b.planes.subarray(4 * k, 4 * k + 4)
      if (dot(plane, p) - plane[3] > 1e-3) return true
    }
    return false
  }
  const along = (distance: number) => light.map((x) => x * distance)
  assert.equal(outside([0, 0, 0]), false, 'the middle of the cube')
  assert.equal(outside(along(30000)), false, 'above it, toward the light: the hull is open there')
  assert.equal(outside(along(-30000)), true, 'under it, away from the light')
  assert.equal(outside(b.right.map((x) => x * 200000)), true, 'far to the side')
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

test('the uniform of a sun places the shadow space, the eye, the trace and the grid', () => {
  const eye = [1000.5, 3, -2000.25]
  const { bounds, floats } = placed(eye)
  const words = new Uint32Array(floats.buffer)
  const field = (name: keyof typeof DFSH_PARAMS.at, k = 0) => DFSH_PARAMS.at[name] + k
  const apply = (m: number, p: number[]) => {
    const h = [0, 1, 2, 3].map((r) =>
      [0, 1, 2, 3].reduce((s, c) => s + floats[m + c * 4 + r] * p[c], 0),
    )
    return [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
  }
  // The shadow space: the sphere's centre in the middle of the depth, at most a snap step from the
  // origin across the light, the depth toward the light the greater, over twice the range.
  const step = (2 * 4) / SETTINGS.snapTexels
  const centre = apply(field('toShadow'), [...bounds.centre, 1])
  assert.ok(Math.abs(centre[0]) < step && Math.abs(centre[1]) < step, `${centre}`)
  near(centre[2], 0.5, 'centre z', 1e-5)
  const range = Math.max(bounds.roundedRadius, 5000)
  const up = apply(field('toShadow'), [
    ...bounds.centre.map((x, k) => x + [0, 1, 0][k] * bounds.radius),
    1,
  ])
  near(up[2], 0.5 + bounds.radius / (2 * range), 'a radius toward the light', 1e-5)
  // The eye as a pair of floats, the trace's steps by the quality, the bias of a two-sided mesh.
  for (let k = 0; k < 3; k++)
    near(floats[field('eyeHigh', k)] + floats[field('eyeLow', k)], eye[k] * 100, 'eye', 1e-7)
  assert.equal(floats[field('trace', 2)], DFSH_STEPS[3])
  assert.equal(floats[field('range', 2)], SETTINGS.twoSidedBias)
  assert.deepEqual(
    [0, 1, 2].map((k) => floats[field('light', k)]),
    [0, 1, 0],
  )
  // The grid of tiles, its room, the meshes, the cube.
  const side = shadowTileSide(bounds.radius, 200)
  assert.equal(words[field('tiles')], side)
  assert.equal(words[field('tiles', 1)], 128 * side * side)
  assert.equal(words[field('tiles', 2)], 1)
  assert.equal(
    words[field('tiles', 3)],
    128,
    'the place of a tile when the lists are not compacted',
  )
  assert.equal(words[field('counts', 1)], 36)
  assert.equal(words[field('counts', 3)], DFSH_FLAG.compactTiles, 'the lists are compacted')
  near(floats[field('expand')], (1.414 * bounds.radius) / side, 'a tile’s half diagonal')
  // The widest cone across the shadow space: 100 centimetres by the largest scale the matrix gives an
  // axis — for a sun straight up, the greater of 1 over the rounded radius and 1 over twice the range.
  near(
    floats[field('expand', 1)],
    100 * Math.max(1 / bounds.roundedRadius, 1 / (2 * range)),
    'the widest cone across the shadow space',
  )
})
