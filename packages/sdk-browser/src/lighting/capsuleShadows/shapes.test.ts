// The shapes that cast capsule shadows: carried from the rest pose to the world, faded, and the light each reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fromHalf } from '../../../../math/src/float/half.ts'
import {
  CAPSULE_SHAPE_FLOATS,
  capsuleAxis,
  minVisibilityOf,
  restCapsule,
  restSphere,
  writeLightDirection,
  writeShadowShapes,
} from './shapes.ts'

const identity = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

/** A column-major matrix of uniform scale `s` and translation `t`. */
const scaleTranslate = (s: number, t: readonly [number, number, number]) =>
  new Float64Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, t[0], t[1], t[2], 1])

test('a sphere is a capsule of length 0 and a z axis, its centre carried by the rest bone', () => {
  const body = restSphere(3, scaleTranslate(1, [1, 2, 3]), [1, 0, 0], 0.5)
  assert.deepEqual(body.center, [2, 2, 3])
  assert.deepEqual(body.axis, [0, 0, 1])
  assert.equal(body.length, 0)
  assert.equal(body.bone, 3)
})

test('a capsule keeps its axis turned by the rest bone, not translated', () => {
  const turn = new Float64Array([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1])
  const body = restCapsule(1, turn, [0, 0, 0], 0.1, [1, 0, 0], 0.4)
  assert.deepEqual(body.center, [5, 0, 0])
  assert.deepEqual(body.axis, [0, 1, 0])
  assert.equal(body.length, 0.4)
})

test('the axis a rotation turns z to, by the quaternion x, y, z, w', () => {
  assert.deepEqual(capsuleAxis([0, 0, 0, 1]), [0, 0, 1])
  const half = Math.SQRT1_2
  // A quarter turn about y takes z to x.
  const axis = capsuleAxis([0, half, 0, half])
  assert.ok(Math.abs(axis[0] - 1) < 1e-12 && Math.abs(axis[1]) < 1e-12 && Math.abs(axis[2]) < 1e-12)
})

test('the world shape: the skin then the object, the view translation on the centre, the largest scale on radius and length', () => {
  const bodies = [
    restCapsule(0, identity(), [1, 0, 0], 0.2, [0, 0, 1], 1),
    restSphere(7, identity(), [0, 0, 0], 0.5),
  ]
  const out = new Float32Array(2 * CAPSULE_SHAPE_FLOATS)
  // Bone 0 is skinned by a doubling and a lift; bone 7 has no skin, so the object's matrix alone carries it.
  const skin = (bone: number) => (bone === 0 ? scaleTranslate(2, [0, 0, 1]) : undefined)
  const count = writeShadowShapes(out, 0, bodies, skin, scaleTranslate(1, [10, 0, 0]), [-1, -2, -3])
  assert.equal(count, 2)
  // centre (1,0,0) doubled (2,0,0), lifted (2,0,1), moved (12,0,1), translated (11,-2,-2).
  assert.deepEqual([...out.slice(0, 8)], [11, -2, -2, Math.fround(0.4), 0, 0, 1, 2])
  assert.deepEqual([...out.slice(8, 16)], [9, -2, -3, 0.5, 0, 0, 1, 0])
})

test('the scale is the largest of the matrix axes, and a degenerate axis is no number', () => {
  // The radius is carried by the largest of the matrix axes.
  const stretched = new Float32Array(CAPSULE_SHAPE_FLOATS)
  writeShadowShapes(
    stretched,
    0,
    [restSphere(0, identity(), [0, 0, 0], 1)],
    () => new Float64Array([3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]),
    identity(),
    [0, 0, 0],
  )
  assert.equal(stretched[3], 3)
  const flat = new Float64Array(16)
  flat[15] = 1
  const out = new Float32Array(CAPSULE_SHAPE_FLOATS)
  writeShadowShapes(
    out,
    0,
    [restCapsule(0, identity(), [0, 0, 0], 1, [0, 0, 1], 1)],
    () => flat,
    identity(),
    [0, 0, 0],
  )
  assert.deepEqual([...out.slice(4, 7)], [0, 0, 0])
  assert.ok(out.every(Number.isFinite))
})

test('the light record packs the angle and the least visibility as two halves of its last word', () => {
  const floats = new Float32Array(8)
  const words = new Uint32Array(floats.buffer)
  writeLightDirection(floats, words, 4, [0, 1, 0], 0.5, 0.25)
  assert.deepEqual([...floats.slice(4, 7)], [0, 1, 0])
  assert.equal(fromHalf(words[7] & 0xffff), 0.5)
  assert.equal(fromHalf(words[7] >>> 16), 0.25)
  assert.equal(minVisibilityOf(-1), 0)
  assert.equal(minVisibilityOf(2), 1)
  assert.equal(minVisibilityOf(0.3), 0.3)
})
