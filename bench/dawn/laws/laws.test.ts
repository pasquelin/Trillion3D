import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exponentOf, lawName, linearFit } from './fit.ts'
import { sceneGltf } from './gltf.ts'
import { cylinder, ground, sphere, trianglesOf } from './meshes.ts'
import { LAWS, lawOf } from './points.ts'
import { DENSITY, KINDS, scatter, sideOf } from './scatter.ts'

test('the shapes hold the triangles their sizes give', () => {
  assert.equal(trianglesOf(sphere([1, 1, 1], 24, 16)), 2 * 24 * 15)
  assert.equal(trianglesOf(cylinder(1, 2, 64)), 4 * 64)
  assert.equal(trianglesOf(ground(10, 8)), 2 * 64)
  const ball = sphere([2, 1, 3], 8, 6)
  for (let i = 0; i < ball.normals.length; i += 3)
    assert.ok(Math.abs(Math.hypot(...ball.normals.subarray(i, i + 3)) - 1) < 1e-6, 'unit normals')
})

test('a world places every object once, in its square, by share, the same on every run', () => {
  const placed = scatter(1001)
  const counts = placed.map((p) => p.scales.length / 3)
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    1001,
  )
  assert.deepEqual(counts.slice(1), [Math.floor(KINDS[1].share * 1001), Math.floor(0.1 * 1001)])
  const half = sideOf(1001) / 2
  for (const { translations } of placed)
    for (let i = 0; i < translations.length; i += 3) {
      assert.ok(Math.abs(translations[i]) <= half && Math.abs(translations[i + 2]) <= half)
      assert.equal(translations[i + 1], 0)
    }
  assert.deepEqual(scatter(1001)[2].translations, placed[2].translations)
  assert.equal(sideOf(400) ** 2 * DENSITY, 400, 'the density holds at any count')
})

test('the glTF names each accessor its count and every view starts on four bytes', () => {
  const placed = scatter(10)
  const { json, bytes } = sceneGltf(
    [
      {
        name: 'ball',
        data: sphere([1, 1, 1], 6, 4),
        material: { color: [1, 1, 1], roughness: 1, metalness: 0 },
      },
    ],
    [{ mesh: 0, instances: placed[0] }, { mesh: 0 }],
    'scene.bin',
  )
  const views = json.bufferViews as { byteOffset: number; byteLength: number }[]
  for (const view of views) assert.equal(view.byteOffset % 4, 0)
  assert.equal(json.buffers[0].byteLength, bytes.length)
  const accessors = json.accessors as {
    count: number
    type: string
    min?: number[]
    max?: number[]
  }[]
  assert.equal(accessors[2].count, 2 * 6 * 3 * 3, 'indices: three a triangle')
  assert.equal(accessors[0].min![1], -1, 'positions bounded: the poles')
  assert.equal(accessors[0].max![1], 1)
  const node = json.nodes[0] as {
    extensions: { EXT_mesh_gpu_instancing: { attributes: Record<string, number> } }
  }
  const { TRANSLATION, ROTATION } = node.extensions.EXT_mesh_gpu_instancing.attributes
  assert.equal(accessors[TRANSLATION].count, placed[0].scales.length / 3)
  assert.equal(accessors[ROTATION].type, 'VEC4')
})

test('a curve reads its exponent: flat, linear, a square root, and a line through its points', () => {
  const xs = [1e3, 1e4, 1e5, 1e6]
  assert.equal(lawName(exponentOf(xs, [5, 5, 5, 5])), 'O(1)')
  assert.equal(
    lawName(
      exponentOf(
        xs,
        xs.map((x) => 3 * x),
      ),
    ),
    'O(N)',
  )
  assert.ok(Math.abs(exponentOf(xs, xs.map(Math.sqrt))! - 0.5) < 1e-12)
  assert.equal(lawName(0.5, 'P'), 'O(P^0.5)')
  assert.equal(exponentOf([1, 2], [0, 0]), null, 'no positive point, no law')
  const { a, b } = linearFit([0, 1, 2], [1, 3, 5])
  assert.ok(Math.abs(a - 1) < 1e-12 && Math.abs(b - 2) < 1e-12)
})

test('every law has its points, each cooked point reading its manifest at the 1 px bound', () => {
  for (const name of Object.keys(LAWS)) {
    const law = lawOf(name)
    assert.ok(law.points.length >= 4, name)
    for (const point of law.points) {
      if (point.scene === null) continue
      assert.ok(
        point.args.some((arg) => /^cache=file:.*manifest\.json$/.test(arg)),
        name,
      )
      assert.ok(point.args.includes('pe=1'), name)
    }
  }
  assert.throws(() => lawOf('weather'), /LAW: weather; one of world/)
})
