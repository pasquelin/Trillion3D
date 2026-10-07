import test from 'node:test'
import assert from 'node:assert/strict'
import { Quaternion } from './quaternion.ts'
import { Matrix4 } from './matrix4.ts'
import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { halton } from '../../../../math/src/sequence/halton.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { axisAngleQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import { composeMatrix4 } from '../../../../math/src/matrix/matrix4Compose.ts'
import {
  fromSpherical,
  POLAR_EPSILON,
  RADIUS_EPSILON,
  toSpherical,
} from '../../../../math/src/vector/spherical.ts'
import { oldToSpherical } from '../../../../../bench/oracles/core/length-rule.ts'

/*
 * The world/math methods moved from `Math.hypot` to the length rule (docs/MATHS.md "Lengths"),
 * each against its old expression written here as the oracle, over N Halton points and edges.
 *
 * Proven by code reading (a), no sweep:
 * - `Quaternion.length` (`hypot4` → `lengthQuaternion`): no engine module calls it; the engine
 *   normalises with `normalizeQuaternion`, which keeps its own twin rule.
 * - `Vector2.length`, `normalize`, `distanceTo` (`hypot2` → `length2`, `normalizeVector2`): the
 *   engine reads a `Vector2` as texture repeat and offset or outline points; its one measure, an
 *   outline's closing point, keeps the former verdict (curves.ts `closes`, shapeClose.test.ts).
 * - `Spherical.setFromVector3`: a host-facing value object; the engine's camera reads
 *   `toSpherical` directly, the orbit swept below.
 */

const N = 4096
const ORIGIN = [0, 0, 0],
  UNIT = [1, 1, 1]
const f32 = (value: number) => Math.fround(value)
/** The `index`-th Halton number of `base` mapped onto `[low, high)`. */
const span = (index: number, base: number, low: number, high: number) =>
  low + (high - low) * halton(index, base)

/** The axis normalisation both methods had: divided by `hypot3`, a zero axis left as is. */
const oldAxis = new Float64Array(3)
function oldAxisAngle(out: Float64Array, x: number, y: number, z: number, angle: number) {
  const n = hypot3(x, y, z) || 1
  oldAxis[0] = x / n
  oldAxis[1] = y / n
  oldAxis[2] = z / n
  return axisAngleQuaternion(out, oldAxis, angle)
}

/** Axes swept: Halton points in a cube around the origin, the same scaled onto the unit sphere,
 *  then the cardinal axes, signed zeroes, the zero axis and axes of 1e200 down to 1e-170. */
function axes() {
  const list: number[][] = []
  for (let i = 1; i <= N; i++) {
    const x = span(i, 2, -4, 4),
      y = span(i, 3, -4, 4),
      z = span(i, 5, -4, 4),
      n = hypot3(x, y, z)
    list.push([x, y, z], [x / n, y / n, z / n])
  }
  for (const s of [1, -1])
    list.push([s, 0, 0], [0, s, 0], [0, 0, s], [s * 0, 0, -0], [0, s * 1e-3, 0])
  // Host axes past the plain sum's range, long and tiny: the same unit turn.
  for (const c of [1e200, 1e155, 1e-163, 1e-170])
    list.push([0, c, 0], [-c, 0, 0], [3 * c, 0, -4 * c])
  return list
}

const assertF32 = (expected: ArrayLike<number>, actual: ArrayLike<number>, label: string) => {
  for (let i = 0; i < expected.length; i++)
    assert.ok(
      Object.is(f32(expected[i]), f32(actual[i])),
      `${label} [${i}]: ${expected[i]} != ${actual[i]}`,
    )
}

test('an axis-angle turn composes the same f32 matrix as the hypot normalisation it replaces', () => {
  const oldTurn = new Float64Array(4),
    oldMatrix = new Float64Array(16),
    newMatrix = new Float64Array(16),
    position = new Float64Array(3),
    scale = new Float64Array(3),
    turn = new Quaternion(),
    rotation = new Matrix4()
  const list = axes()
  list.forEach(([x, y, z], k) => {
    const angle = span(k + 1, 7, -2 * Math.PI, 2 * Math.PI)
    for (let c = 0; c < 3; c++) {
      position[c] = span(k + 1, [11, 13, 17][c], -100, 100)
      scale[c] = span(k + 1, [19, 23, 29][c], 0.01, 10)
    }
    oldAxisAngle(oldTurn, x, y, z, angle)
    // Quaternion.setFromAxisAngle, read by a node's compose (object3d.rotateOnAxis).
    turn.setFromAxisAngle({ x, y, z }, angle)
    composeMatrix4(oldMatrix, position, oldTurn, scale)
    composeMatrix4(newMatrix, position, turn.elements, scale)
    assertF32(oldMatrix, newMatrix, `setFromAxisAngle ${[x, y, z, angle]}`)
    // Matrix4.makeRotationAxis.
    composeMatrix4(oldMatrix, ORIGIN, oldTurn, UNIT)
    rotation.makeRotationAxis({ x, y, z }, angle)
    assertF32(oldMatrix, rotation.elements, `makeRotationAxis ${[x, y, z, angle]}`)
  })
})

test('a cardinal axis turns to the same bits as before, quaternion and matrix', () => {
  const oldTurn = new Float64Array(4),
    oldMatrix = new Float64Array(16),
    turn = new Quaternion(),
    rotation = new Matrix4()
  for (let i = 1; i <= N; i++) {
    const angle = span(i, 2, -2 * Math.PI, 2 * Math.PI)
    for (const [x, y, z] of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]) {
      oldAxisAngle(oldTurn, x, y, z, angle)
      turn.setFromAxisAngle({ x, y, z }, angle)
      oldTurn.forEach((value, c) => assert.ok(Object.is(value, turn.elements[c])))
      composeMatrix4(oldMatrix, ORIGIN, oldTurn, UNIT)
      rotation.makeRotationAxis({ x, y, z }, angle)
      oldMatrix.forEach((value, c) => assert.ok(Object.is(value, rotation.elements[c])))
    }
  }
})

/**
 * One orbit `update()` under the default bounds (camera/controls/orbitControls.ts): the offset to
 * the target read into spherical coordinates, the radius and polar angle clamped (the azimuth's
 * clamp is the identity on its infinite default arc), written back, the target added. Returns
 * whether the offset defined its angles.
 */
function orbit(
  read: typeof toSpherical,
  position: Float64Array,
  center: ArrayLike<number>,
  spherical: Float64Array,
) {
  const offset = new Float64Array(3)
  for (let i = 0; i < 3; i++) offset[i] = position[i] - center[i]
  read(spherical, offset)
  const resolved = spherical[0] > RADIUS_EPSILON
  spherical[0] = clampCompare(spherical[0], RADIUS_EPSILON, Infinity)
  spherical[2] = clampCompare(spherical[2], POLAR_EPSILON, Math.PI - POLAR_EPSILON)
  fromSpherical(offset, spherical)
  for (let i = 0; i < 3; i++) position[i] = center[i] + offset[i]
  return resolved
}

test('an orbit round trip writes the same f32 camera position and polar angle as hypot did', () => {
  const center = new Float64Array(3),
    start = new Float64Array(3),
    oldPosition = new Float64Array(3),
    newPosition = new Float64Array(3),
    oldSpherical = new Float64Array(3),
    newSpherical = new Float64Array(3)
  const edges = [
    [0, 0, 0],
    [-0, 0, -0],
    [0, 5, 0],
    [0, -5, 0],
    [3, 4, 12],
    [RADIUS_EPSILON, 0, 0],
    [RADIUS_EPSILON * 1.0000001, 0, 0],
    [1e-3, 0, 0],
  ]
  for (let i = 1; i <= N + edges.length; i++) {
    for (let c = 0; c < 3; c++) {
      center[c] = span(i + N, [2, 3, 5][c], -50, 50)
      start[c] = i <= N ? span(i, [2, 3, 5][c], -60, 60) : center[c] + edges[i - N - 1][c]
    }
    oldPosition.set(start)
    newPosition.set(start)
    oldSpherical.set([0, 0.3, 0.8])
    newSpherical.set([0, 0.3, 0.8])
    const oldResolved = orbit(oldToSpherical, oldPosition, center, oldSpherical)
    const newResolved = orbit(toSpherical, newPosition, center, newSpherical)
    assert.equal(newResolved, oldResolved, `resolved ${[...start]}`)
    assertF32(oldPosition, newPosition, `position ${[...start]}`)
    assertF32(oldSpherical, newSpherical, `spherical ${[...start]}`)
  }
})
