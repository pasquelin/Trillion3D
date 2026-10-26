// The sun's distance-field shadow: where its cascade lies, and what the passes are told of it.

import test from 'node:test'
import assert from 'node:assert/strict'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { cascadeBounds } from './bounds.ts'
import {
  DFSH_CUBE,
  DFSH_FINAL,
  DFSH_PARAMS,
  DFSH_PARAMS_STRIDE,
  DFSH_STEPS,
  DFSH_SUBSURFACE_DENSITY,
  shadowTileSide,
} from './layout.ts'
import {
  boundsOf,
  downsampleOf,
  traceSize,
  writeDfshFinal,
  writeDfshParams,
  type DfshImage,
  type DfshLight,
  type DfshSettings,
} from './params.ts'

const near = (a: number, b: number, why: string, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${why}: ${a} against ${b}`)
const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The camera of a 1000 × 500 view at `eye` (metres), looking down -z, a 90 degree field across, near 10 m. */
function camera(eye = [0, 0, 0]): DfshImage {
  const f = 1,
    aspect = 2,
    nearPlane = 10
  const projection = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, 0, -1, 0, 0, nearPlane, 0]
  const world = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, eye[0], eye[1], eye[2], 1]
  const view = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -eye[0], -eye[1], -eye[2], 1]
  // projection · view, column-major.
  const viewProjection = new Float64Array(16)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++)
        viewProjection[c * 4 + r] += projection[k * 4 + r] * view[c * 4 + k]
  return {
    ...{ view: [1000, 500], extent: [1024, 512], world, projection, viewProjection },
    ...{ eye, near: nearPlane, far: 5000, perspective: true },
  }
}

const SUN: DfshLight = {
  lane: 1,
  toLight: [0, 1, 0],
  angularRadius: 0.5357 * DEG2RAD,
  cascade: {
    ...{ near: 100, far: 512, minDepth: 73, maxDepth: 512 },
    ...{ fadeOffset: 500, invFadeLength: 1 / 12, nearFadeOffset: 73, invNearFadeLength: 1 / 27 },
  },
  traceDistance: 100,
  rayStartOffset: 0.003,
  amount: 1,
}

const SETTINGS: DfshSettings = {
  ...{ quality: 3, fullResolution: false, tileSize: 2 },
  ...{ twoSidedBias: 1, perTile: 128, farMeshes: true },
}

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
  // The shadow space: the sphere's centre at z 1 of the middle, its radius one, toward the light the greater.
  const centre = apply(field('toShadow'), [...bounds.centre, 1])
  near(centre[0], 0, 'centre x', 1e-5)
  near(centre[1], 0, 'centre y', 1e-5)
  near(centre[2], 1, 'centre z', 1e-5)
  const up = apply(field('toShadow'), [
    ...bounds.centre.map((x, k) => x + SUN.toLight[k] * bounds.radius),
    1,
  ])
  near(up[2], 2, 'a radius toward the light', 1e-5)
  // The eye as a pair of floats, the trace's steps by the quality.
  for (let k = 0; k < 3; k++)
    near(floats[field('eyeHigh', k)] + floats[field('eyeLow', k)], image.eye[k] * 100, 'eye', 1e-7)
  assert.equal(floats[field('trace', 2)], DFSH_STEPS[3])
  near(
    floats[field('trace', 3)],
    DFSH_SUBSURFACE_DENSITY,
    'the density a thin surface lets light through by',
  )
  near(floats[field('trace')], 10000, 'trace distance in centimetres')
  near(floats[field('light', 3)], Math.tan(2 * 0.5357 * DEG2RAD), 'the sun’s tangent', 1e-6)
  near(floats[field('range')], 73 * 100, 'nearest depth, centimetres')
  near(floats[field('range', 1)], 512 * 100, 'farthest depth')
  // The grid of tiles, its room, the meshes, the cube.
  const side = shadowTileSide(bounds.radius, 200)
  assert.equal(words[field('tiles')], side)
  assert.equal(words[field('tiles', 1)], 128 * side * side)
  assert.equal(words[field('tiles', 2)], 99)
  assert.equal(words[field('counts', 1)], 36)
  assert.equal(words[field('counts', 3)], 1, 'the far-shadow test reaches every mesh')
  assert.deepEqual([...words.subarray(field('view'), field('view') + 4)], [1000, 500, 2, 1])
  near(floats[field('expand')], (1.414 * bounds.radius) / side, 'a tile’s half diagonal')
  near(floats[field('expand', 1)], 100 / bounds.radius, 'the widest cone across the shadow space')
  // The block of light 0 is another, untouched.
  assert.equal(floats[0], 0)
})

test('the tangent of a sun’s disk is held between 0.001 and 5 degrees of its apex angle', () => {
  const image = camera()
  const tangent = (angularRadius: number) => {
    const floats = new Float32Array(DFSH_PARAMS_STRIDE / 4)
    const light = { ...SUN, angularRadius }
    writeDfshParams(
      floats,
      new Uint32Array(floats.buffer),
      0,
      { image, light, bounds: boundsOf(image, light), layer: 0 },
      SETTINGS,
      { objects: 1 },
    )
    return floats[DFSH_PARAMS.at.light + 3]
  }
  near(tangent(0.2678 * DEG2RAD), Math.tan(0.5356 * DEG2RAD), 'a sun’s own', 1e-4)
  near(tangent(0), Math.tan(0.001 * DEG2RAD), 'a point source')
  near(tangent(1), Math.tan(5 * DEG2RAD), 'a large disk')
})

test('the quality 1 trace has no transmitted light: its density is 0, at the quality 2 it is the opacity 1’s', () => {
  const image = camera()
  const bounds = boundsOf(image, SUN)
  const density = (quality: number) => {
    const floats = new Float32Array(DFSH_PARAMS_STRIDE / 4)
    const words = new Uint32Array(floats.buffer)
    const settings = { ...SETTINGS, quality }
    writeDfshParams(floats, words, 0, { image, light: SUN, bounds, layer: 0 }, settings, {
      objects: 1,
    })
    return floats[DFSH_PARAMS.at.trace + 3]
  }
  assert.equal(density(1), 0)
  near(density(2), 0.05 * Math.log(100), 'density of an opacity of 1, held to 0.99', 1e-6)
})

test('the trace is at half the view’s size unless it is at the view’s', () => {
  assert.equal(downsampleOf({ fullResolution: false }), 2)
  assert.equal(downsampleOf({ fullResolution: true }), 1)
  assert.deepEqual(traceSize([1001, 500], 2), [501, 250])
  assert.deepEqual(traceSize([1001, 500], 1), [1001, 500])
})

test('the final pass is told each lane’s cascade in centimetres, a lane with none left empty', () => {
  const image = camera()
  const floats = new Float32Array(DFSH_FINAL.words)
  const words = new Uint32Array(floats.buffer)
  writeDfshFinal(floats, words, image, [SUN], SETTINGS)
  const at = DFSH_FINAL.at
  const lane = (k: number) => at.lights + k * 12
  assert.deepEqual([...words.subarray(at.view, at.view + 4)], [1000, 500, 2, 1])
  assert.deepEqual([...words.subarray(at.extent, at.extent + 2)], [1024, 512])
  assert.deepEqual(
    [...words.subarray(lane(0) + 8, lane(0) + 12)],
    [0, 0, 0, 0],
    'no cascade for lane 0',
  )
  assert.deepEqual([...words.subarray(lane(1) + 8, lane(1) + 12)], [1, 0, 0, 0], 'lane 1, layer 0')
  near(floats[lane(1)], 7300, 'minimum depth')
  near(floats[lane(1) + 1], 51200, 'maximum depth')
  near(floats[lane(1) + 2], 50000, 'where it fades out')
  near(floats[lane(1) + 3], 1 / 1200, 'the inverse length, per centimetre', 1e-6)
  near(floats[lane(1) + 4], 7300, 'where it fades in')
  assert.equal(floats[lane(1) + 6], 1, 'the share it keeps')
})
