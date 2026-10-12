// cone.ts: rejection of a box by its normal cone, compared against the reference built with the
// host library's primitives (`referenceConeRejects`, `bench/oracles/browser/volumes.ts`), under
// conformal and hostile placement.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { boxConeRejects } from '../../../../../../../packages/sdk-core/src/index.ts'
import { referenceConeRejects } from '../../../../../../oracles/browser/volumes.ts'

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

/** The host-library oracle's verdict on a case `engineRejects` reads. */
const oracleRejects = (c: Parameters<typeof engineRejects>[0]) =>
  referenceConeRejects(
    { axis: c.coneAxis, angle: c.angle },
    c.world,
    c.min,
    c.max,
    c.normal,
    c.scaling,
    c.eyePos,
  )

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
    assert.equal(engineRejects(c), oracleRejects(c))
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
  assert.equal(engineRejects(c), oracleRejects(c))
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
  assert.equal(oracleRejects(c), false)
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
    assert.equal(engineRejects(c), oracleRejects(c))
  }
})
