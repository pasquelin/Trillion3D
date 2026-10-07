// The length rule on a soft body's masses (docs/MATHS.md "Lengths"): each rope piece's length and
// each triangle's area, swept over Halton meshes and scales against their former expression —
// `hypot3` —, every f32 mass word identical, the whole measure read through a given mass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { plane, sphere } from '../world/geometry/basic.ts'
import type { Geometry } from '../world/geometry/geometry.ts'
import { positions } from './shape.fixture.ts'
import { PHYSICS_STEP } from './options.ts'
import {
  SOFT_AREAL_DENSITY,
  SOFT_LINEAR_DENSITY,
  softBodyOf,
  type SoftBodyOptions,
} from './soft.ts'
import { SOFT_VERTEX_WORDS as W } from './softLayout.ts'
import { softSettings } from './softSettings.ts'
import { halton } from '../../../math/src/sequence/halton.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { crossVector3 } from '../../../math/src/vector/vector.ts'

type Scale = { x: number; y: number; z: number }

/**
 * The mass words the former `spreadMass` writes, word for word, on the welded vertices and
 * triangles the record holds: each scaled edge's length (a rope) or each triangle's area by
 * `hypot3`, shared into f32 words, then every word times the density or the given mass over the
 * whole.
 */
function oldMasses(vertices: Float32Array, indices: Uint32Array, s: Scale, mass?: number) {
  const count = vertices.length / W,
    scale = [s.x, s.y, s.z],
    words = new Float32Array(count)
  const edge = (a: number, b: number) =>
    [0, 1, 2].map((k) => vertices[b * W + k] * scale[k] - vertices[a * W + k] * scale[k])
  let whole = 0
  if (!indices.length)
    for (let i = 0; i + 1 < count; i++) {
      const u = edge(i, i + 1),
        length = hypot3(u[0], u[1], u[2])
      words[i] += length / 2
      words[i + 1] += length / 2
      whole += length
    }
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]]
    const n = crossVector3([0, 0, 0], edge(a, b), edge(a, c)),
      area = hypot3(n[0], n[1], n[2]) / 2
    for (const v of [a, b, c]) words[v] += area / 3
    whole += area
  }
  const density = indices.length ? SOFT_AREAL_DENSITY : SOFT_LINEAR_DENSITY
  const factor = mass === undefined ? density : mass / whole
  for (let i = 0; i < count; i++) words[i] *= factor
  return words
}

/** `count` vertices of the cube [−2, 2]³ from the Halton terms from `from`. */
const cloud = (from: number, count: number) =>
  Array.from(
    { length: 3 * count },
    (_, k) => 4 * halton(from + Math.floor(k / 3), [2, 3, 5][k % 3]) - 2,
  )

test('a soft body’s mass words of the former length and area, every f32 the same', () => {
  // 4096 swept vertices: a cloth of 2048 in overlapping strips, a rope of 2048; each under seven
  // scales, uniform or not, one mirrored; the edges are the plane and sphere the soft tests use.
  const strip = Array.from({ length: 3 * 2046 }, (_, k) => Math.floor(k / 3) + (k % 3))
  const meshes: [Geometry, 'cloth' | 'rope'][] = [
    [positions(cloud(1, 2048), strip), 'cloth'],
    [positions(cloud(2049, 2048)), 'rope'],
    [plane(2, 1, 4, 2), 'cloth'],
    [sphere(1, 8, 6), 'cloth'],
  ]
  const scales: Scale[] = [
    { x: 1, y: 1, z: 1 },
    { x: -1.5, y: 1.5, z: 1.5 },
  ]
  for (let i = 1; i <= 5; i++) {
    const at = (base: number) => 10 ** (4 * halton(i, base) - 2)
    scales.push({ x: at(7), y: at(11), z: at(13) })
  }
  let words = 0
  for (const [geometry, type] of meshes)
    for (const scale of scales)
      for (const mass of [undefined, 3.7]) {
        const options = { type, mass } as SoftBodyOptions
        const record = softBodyOf(geometry, scale, softSettings(options), PHYSICS_STEP)
        const expected = oldMasses(record.vertices, record.indices, scale, mass)
        expected.forEach((word, v) => {
          assert.ok(Object.is(word, record.vertices[v * W + 3]), `${type} vertex ${v}`)
          words++
        })
      }
  assert.ok(words > 4096 * 7)
})
