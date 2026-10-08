// "When to switch": each depth is the distance at which its condition turns true, the switch
// is the later of the two, and a manifest entry yields the switch input only when it is drawable.
import assert from 'node:assert/strict'
import test from 'node:test'
import { PI } from '../../../math/src/constants.ts'
import { near } from '../../../math/src/float/near.fixture.ts'
import { bakedMesh } from './bakedMesh.fixture.ts'
import {
  drawsImpostor,
  impostorSwitchDepth,
  impostorSwitchOf,
  impostorTexelDepth,
  impostorTriangleDepth,
  type ImpostorSwitchInput,
} from './switch.ts'

const FOCAL = 1117
/** Pixels across the object's disc, and pixels it covers, at depth `z`. */
const across = (radius: number, z: number) => (2 * radius * FOCAL) / z
const covered = (radius: number, coverage: number, z: number) =>
  coverage * PI * ((radius * FOCAL) / z) ** 2

const SHARPNESS_BOUND = { objectRadius: 2, rootTriangles: 1e6, coverage: 0.5, frameSide: 64 }
const TRIANGLE_BOUND = { objectRadius: 2, rootTriangles: 10, coverage: 0.5, frameSide: 4096 }

test('the texel depth is where one frame texel lands on one pixel', () => {
  for (const [radius, frameSide] of [
    [2, 64],
    [0.6, 128],
    [40, 256],
  ])
    near(
      [across(radius, impostorTexelDepth(radius, frameSide, FOCAL))],
      [frameSide],
      'texels',
      1e-9,
    )
})

test('the triangle depth is where the root triangles equal the pixels the object covers', () => {
  for (const [radius, triangles, coverage] of [
    [2, 460, 0.66],
    [4.2, 2100, 0.43],
    [40, 1e6, 1],
  ]) {
    const z = impostorTriangleDepth(radius, triangles, coverage, FOCAL)
    near([covered(radius, coverage, z)], [triangles], 'covered pixels', 1e-6)
  }
})

test('the switch waits for the later condition, and draws from its depth on', () => {
  const depths = (input: ImpostorSwitchInput) => [
    impostorTexelDepth(input.objectRadius, input.frameSide, FOCAL),
    impostorTriangleDepth(input.objectRadius, input.rootTriangles, input.coverage, FOCAL),
  ]
  const [sharpTexel, sharpTriangle] = depths(SHARPNESS_BOUND)
  const [costTexel, costTriangle] = depths(TRIANGLE_BOUND)
  assert.ok(sharpTexel > sharpTriangle && costTriangle > costTexel, 'one input per bound')
  for (const [input, later] of [
    [SHARPNESS_BOUND, sharpTexel],
    [TRIANGLE_BOUND, costTriangle],
  ] as const) {
    const z = impostorSwitchDepth(input, FOCAL)
    assert.equal(z, later)
    assert.equal(drawsImpostor(input, FOCAL, z), true, 'draws at its depth')
    assert.equal(drawsImpostor(input, FOCAL, z * (1 - 1e-12)), false, 'whole just nearer')
  }
})

test('the largest placement scale moves the switch out in proportion', () => {
  for (const input of [SHARPNESS_BOUND, TRIANGLE_BOUND]) {
    const unscaled = impostorSwitchDepth(input, FOCAL)
    assert.equal(impostorSwitchDepth({ ...input, maxWorldScale: 1 }, FOCAL), unscaled)
    near([impostorSwitchDepth({ ...input, maxWorldScale: 3 }, FOCAL)], [3 * unscaled], 'R', 1e-9)
  }
})

test('a drawable entry yields its four numbers and the placement scale; any other none', () => {
  const tree = bakedMesh(3, 'tree', SHARPNESS_BOUND)
  for (const scale of [undefined, 3])
    assert.deepEqual(impostorSwitchOf(tree, scale), {
      ...SHARPNESS_BOUND,
      maxWorldScale: scale ?? 1,
    })
  assert.equal(impostorSwitchOf({ ...tree, status: 'refused' }), undefined)
  assert.equal(impostorSwitchOf({ ...tree, maps: undefined }), undefined)
  for (const field of ['objectRadius', 'rootTriangles', 'coverage'])
    for (const bad of [0, -1, NaN, Infinity, -Infinity, undefined])
      assert.equal(impostorSwitchOf({ ...tree, [field]: bad }), undefined, `${field}: ${bad}`)
})
