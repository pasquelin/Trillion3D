// The head's elevation moved from `hypot2` to `length2` (#1493): read back from a host
// orientation, then turned by the pointer. An oracle takes the length as a parameter; run with the
// new one it gives the controller's own orientation bit for bit, which proves the oracle is the
// controller; run with the old one, the same orientation once in float32 — after one gesture, and
// at every step of a chain of gestures, where the head carries its two angles in double from the
// one read-back, on HALTON_SWEEP points.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { rotateByQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { orbitOrientation } from './math.ts'
import { HEAD_DEFAULTS } from './look.ts'
import { createFirstPersonCameraControls } from './firstPersonControls.ts'
import { fixtureCamera, fixtureDrag, fixtureSurface } from './controls.fixture.ts'
import { NEW, OLD, quaternion, type Lengths } from './mathMoves.fixture.ts'

type Head = { yaw: number; pitch: number }

/** `createHead`'s sample: a host orientation read back into yaw and pitch. */
function readHead(L: Lengths, q: Float64Array): Head {
  const f = rotateByQuaternion(new Float64Array(3), q, 0, 0, -1)
  return { yaw: Math.atan2(-f[0], -f[2]), pitch: Math.atan2(f[1], L.l2(f[0], f[2])) }
}

/** `createHead`'s turn: the look of `(dx, dy)` pixels applied, the level orientation rebuilt. */
function turnHead(head: Head, dx: number, dy: number) {
  head.yaw -= dx * 0.002
  head.pitch = clampCompare(head.pitch - dy * 0.002, HEAD_DEFAULTS.minPitch, HEAD_DEFAULTS.maxPitch)
  return orbitOrientation(new Float64Array(4), [0, head.yaw, HALF_PI + head.pitch])
}

/** The camera's orientation after a drag of `(dx, dy)`, against both oracles. */
function assertTurn(
  camera: ReturnType<typeof fixtureCamera>,
  ours: Float64Array,
  old: Float64Array,
  at: string,
) {
  const { x, y, z, w } = camera.quaternion,
    now = [x, y, z, w]
  for (let k = 0; k < 4; k++) {
    assert.ok(Object.is(now[k], ours[k]), `oracle ${at}.${k}`)
    assertSameFloat32(old[k], now[k], `head ${at}.${k}`)
  }
}

test('look: a host orientation read back keeps the head in float32', () => {
  const camera = fixtureCamera(),
    surface = fixtureSurface(400),
    controls = createFirstPersonCameraControls(camera, surface.element)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const q = quaternion(i),
      dx = Math.round(haltonSpan(i, 11, -40, 40)),
      dy = Math.round(haltonSpan(i, 13, -40, 40))
    camera.quaternion.set(q[0], q[1], q[2], q[3])
    fixtureDrag(surface, dx, dy)
    controls.update(0)
    assertTurn(
      camera,
      turnHead(readHead(NEW, q), dx, dy),
      turnHead(readHead(OLD, q), dx, dy),
      `${i}`,
    )
  }
})

test('look: a chain of 24 gestures keeps the head in float32 at every step', () => {
  const camera = fixtureCamera(),
    surface = fixtureSurface(400),
    controls = createFirstPersonCameraControls(camera, surface.element)
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const q = quaternion(i)
    camera.quaternion.set(q[0], q[1], q[2], q[3])
    const ours = readHead(NEW, q),
      old = readHead(OLD, q)
    for (let s = 1; s <= 24; s++) {
      const dx = Math.round(haltonSpan(i * 24 + s, 11, -40, 40)),
        dy = Math.round(haltonSpan(i * 24 + s, 13, -40, 40))
      fixtureDrag(surface, dx, dy)
      controls.update(0)
      assertTurn(camera, turnHead(ours, dx, dy), turnHead(old, dx, dy), `${i} step ${s}`)
    }
  }
})
