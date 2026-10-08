import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GOLDEN_FRACTION, TAU } from '../../../packages/math/src/constants.ts'
import {
  HALTON_SWEEP,
  edgeValues,
  haltonSpan,
} from '../../../packages/math/src/sequence/sweep.fixture.ts'
import { yaw } from './gltf-scene.ts'
import { snap } from './random.ts'

/** The node rotation `yaw` wrote by hand before it called `axisAngleQuaternion`. */
const oldYaw = (angle: number) =>
  [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)].map(
    (value) => Math.round(snap(value) * 1e6) / 1e6,
  )

test('a node turned about +Y is written as before: the same numbers, the same JSON', () => {
  const angles = [
    ...edgeValues(-TAU, TAU),
    ...Array.from({ length: HALTON_SWEEP }, (_, i) => haltonSpan(i + 1, 2, -TAU, TAU)),
  ]
  for (const angle of angles) {
    assert.equal(JSON.stringify(yaw(angle)), JSON.stringify(oldYaw(angle)), `angle ${angle}`)
    // The avenue draws its angles in [0, TAU): there even the zeros' signs are the same.
    if (angle >= 0 && !Object.is(angle, -0))
      yaw(angle).forEach((value, k) => assert.ok(Object.is(value, oldYaw(angle)[k]), `${angle}`))
  }
})

test("the icosahedron's golden ratio is the one it was written as", () => {
  assert.ok(Object.is(1 + GOLDEN_FRACTION, (1 + Math.sqrt(5)) / 2))
})
