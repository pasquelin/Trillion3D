// cone.ts: rejection of a box by its normal cone, compared against a reference built
// with the host library's primitives (Vector3, Matrix3, Matrix4), under conformal and hostile placement.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { boxConeRejects, coneRejects } from '../../../../../../../packages/sdk-core/src/index.ts'
import { boxConeRejectsBefore, coneCases } from '../../../../../../oracles/core/hot-path-math.ts'

/** `packages/sdk-browser/src/page/cone/cone.ts`, copied with reference primitives (see `bench/oracles/core/volumes.ts`). */
function reference(
  coneAxis: number[],
  angle: number,
  min: number[],
  max: number[],
  world: THREE.Matrix4,
  normal: THREE.Matrix3,
  scaling: number,
  eyePos: number[],
) {
  const centre = new THREE.Vector3(
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ).applyMatrix4(world)
  const radius =
    Math.hypot((max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5) * scaling
  const d = centre.distanceTo(new THREE.Vector3(...(eyePos as [number, number, number])))
  const spread = d > radius ? Math.asin(Math.min(1, Math.max(0, radius / d))) : Math.PI
  const axis = new THREE.Vector3(...(coneAxis as [number, number, number])).applyMatrix3(normal)
  const len = axis.length()
  if (!(len > 0)) return false
  axis.multiplyScalar(1 / len)
  const view = new THREE.Vector3(...(eyePos as [number, number, number])).sub(centre)
  const vl = view.length()
  if (!(vl > 0)) return false
  const dot = Math.min(1, Math.max(-1, axis.dot(view) / vl))
  try {
    return coneRejects(dot, angle, spread)
  } catch {
    return false
  }
}

function engineRejects(c: {
  coneAxis: number[]
  angle: number
  min: number[]
  max: number[]
  world: THREE.Matrix4
  normal: THREE.Matrix3
  scaling: number
  eyePos: number[]
}) {
  return boxConeRejects(
    c.coneAxis,
    c.angle,
    c.min,
    c.max,
    c.world.elements,
    c.normal.elements,
    c.scaling,
    c.eyePos[0],
    c.eyePos[1],
    c.eyePos[2],
  )
}

function place(sx: number, sy: number, sz: number, position: number[], euler: number[]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2]))
  return new THREE.Matrix4().compose(
    new THREE.Vector3(position[0], position[1], position[2]),
    q,
    new THREE.Vector3(sx, sy, sz),
  )
}

test('boxConeRejects matches the host-library oracle under conformal placement (uniform scale and rotation)', () => {
  for (const [sx, sy, sz] of [
    [2, 2, 2],
    [0.5, 0.5, 0.5],
  ]) {
    const world = place(sx, sy, sz, [3, -1, 2], [0.4, -0.7, 1.1])
    const normal = new THREE.Matrix3().getNormalMatrix(world)
    const c = {
      coneAxis: [0.2, 0.9, -0.1],
      angle: Math.PI / 4,
      min: [-1, -1, -1],
      max: [1, 1, 1],
      world,
      normal,
      scaling: sx,
      eyePos: [10, 8, 6],
    }
    assert.equal(
      engineRejects(c),
      reference(c.coneAxis, c.angle, c.min, c.max, world, normal, c.scaling, c.eyePos),
    )
  }
})

test('eye inside bounding sphere yields spread of π and never rejects', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0, 0, 0])
  const normal = new THREE.Matrix3().getNormalMatrix(world)
  const c = {
    coneAxis: [0, 1, 0],
    angle: 0,
    min: [-1, -1, -1],
    max: [1, 1, 1],
    world,
    normal,
    scaling: 1,
    eyePos: [0.1, 0.1, 0.1], // inside the box
  }
  assert.equal(engineRejects(c), false)
  assert.equal(
    engineRejects(c),
    reference(c.coneAxis, c.angle, c.min, c.max, world, normal, c.scaling, c.eyePos),
  )
})

/** A unit box turned by `euler`, seen from (20, 0, 0) under a cone of `coneAxis` and `angle`: neither
 *  the engine nor the host library rejects it. */
function assertNeitherRejects(euler: number[], coneAxis: number[], angle: number) {
  const world = place(1, 1, 1, [0, 0, 0], euler)
  const normal = new THREE.Matrix3().getNormalMatrix(world)
  const c = {
    coneAxis,
    angle,
    min: [-1, -1, -1],
    max: [1, 1, 1],
    world,
    normal,
    scaling: 1,
    eyePos: [20, 0, 0],
  }
  assert.equal(engineRejects(c), false)
  assert.equal(
    reference(c.coneAxis, c.angle, c.min, c.max, world, normal, c.scaling, c.eyePos),
    false,
  )
}

test('zero cone axis never rejects (neither does the oracle)', () => {
  assertNeitherRejects([0.3, 0.1, 0], [0, 0, 0], Math.PI / 6)
})

test('angle outside [0, π] is refused by coneRejects, so does not reject (try/catch)', () => {
  assertNeitherRejects([0, 0, 0], [0, 1, 0], 5) // angle > π
})

test('tangent cone rejects exactly like the oracle, on both sides of tangency', () => {
  const world = place(1, 1, 1, [0, 0, 0], [0, 0, 0])
  const normal = new THREE.Matrix3().getNormalMatrix(world)
  const base = {
    min: [-0.01, -0.01, -0.01],
    max: [0.01, 0.01, 0.01],
    world,
    normal,
    scaling: 1,
    eyePos: [0, 0, 100],
  }
  for (const angle of [Math.PI / 6 - 1e-6, Math.PI / 6, Math.PI / 6 + 1e-6]) {
    const c = { ...base, coneAxis: [0, 0, -1], angle }
    assert.equal(
      engineRejects(c),
      reference(c.coneAxis, c.angle, c.min, c.max, world, normal, c.scaling, c.eyePos),
    )
  }
})

test('boxConeRejects keeps the verdict it had before its early exit, on 300 000 cases', () => {
  const cases = coneCases(917)
  const seen = [0, 0]
  for (let i = 0; i < 300_000; i++) {
    const c = cases(i)
    const { axis, angle, min, max, world, normal, scale, eye } = c
    const [ex, ey, ez, ew] = eye
    const verdict = boxConeRejects(axis, angle, min, max, world, normal, scale, ex, ey, ez, ew)
    if (verdict !== boxConeRejectsBefore(axis, angle, min, max, world, normal, scale, eye))
      assert.fail(JSON.stringify(c))
    seen[+verdict]++
  }
  assert.ok(seen[0] > 0 && seen[1] > 0, `both verdicts met: ${seen}`)
})
