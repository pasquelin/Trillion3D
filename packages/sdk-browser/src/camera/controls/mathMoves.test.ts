// The controllers' lengths moved from `hypot2`/`hypot3` to `length2`/`length3` (#1493): each
// gesture is replayed by an oracle that takes its lengths as a parameter. Run with the new ones it
// gives the controller's own pose bit for bit, which proves the oracle is the controller; run with
// the old ones, the same pose once in float32, on HALTON_SWEEP points.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { hypot2, hypot3 } from '../../../../math/src/float/hypot.ts'
import { length2, length3 } from '../../../../math/src/vector/vector.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { RADIUS_EPSILON } from '../../../../math/src/vector/spherical.ts'
import {
  normalizeQuaternion,
  rotateByQuaternion,
} from '../../../../math/src/quaternion/quaternion.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { dollyDistance, orbitOrientation, panOffset, pixelWorldScale } from './math.ts'
import { HEAD_DEFAULTS } from './look.ts'
import { createFirstPersonCameraControls } from './firstPersonControls.ts'
import { createPanZoomCameraControls } from './panZoomControls.ts'
import { fixtureCamera, fixtureDrag, fixturePinch, fixtureSurface } from './controls.fixture.ts'

type Lengths = {
  l2: (x: number, y: number) => number
  l3: (x: number, y: number, z: number) => number
}
const OLD: Lengths = { l2: hypot2, l3: hypot3 },
  NEW: Lengths = { l2: length2, l3: length3 }

/** The `i`-th Halton unit quaternion, from bases 2, 3, 5 and 7. */
function quaternion(i: number) {
  const q = new Float64Array(4)
  for (let k = 0; k < 4; k++) q[k] = haltonSpan(i, [2, 3, 5, 7][k], -1, 1)
  return normalizeQuaternion(q)
}

/** `createHead`'s sample and turn: a host orientation read back into yaw and pitch, the look
 *  of `(dx, dy)` pixels applied, the level orientation rebuilt. */
function headTurn(L: Lengths, q: Float64Array, dx: number, dy: number) {
  const f = rotateByQuaternion(new Float64Array(3), q, 0, 0, -1)
  const pitch = Math.atan2(f[1], L.l2(f[0], f[2])),
    yaw = Math.atan2(-f[0], -f[2]) - dx * 0.002
  const kept = clampCompare(pitch - dy * 0.002, HEAD_DEFAULTS.minPitch, HEAD_DEFAULTS.maxPitch)
  return orbitOrientation(new Float64Array(4), [0, yaw, HALF_PI + kept])
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
    const { x, y, z, w } = camera.quaternion,
      now = [x, y, z, w]
    const ours = headTurn(NEW, q, dx, dy),
      old = headTurn(OLD, q, dx, dy)
    for (let k = 0; k < 4; k++) {
      assert.ok(Object.is(now[k], ours[k]), `oracle ${i}.${k}`)
      assertSameFloat32(old[k], now[k], `head ${i}.${k}`)
    }
  }
})

/** The pivot's state: eye, pivot and the camera's fixed orientation. */
type Pivot = {
  position: Float64Array
  center: Float64Array
  q: Float64Array
  min: number
  max: number
}

/** `createPivotControls().apply`: the eye put back within the distance range. */
function apply(L: Lengths, p: Pivot, offset: Float64Array) {
  let radius = L.l3(offset[0], offset[1], offset[2])
  if (radius <= RADIUS_EPSILON) {
    rotateByQuaternion(offset, p.q, 0, 0, 1)
    radius = 1
  }
  const far = Math.max(p.max, p.min, RADIUS_EPSILON),
    kept = clampCompare(radius, Math.max(p.min, RADIUS_EPSILON), far)
  for (let k = 0; k < 3; k++) p.position[k] = p.center[k] + (offset[k] * kept) / radius
}

/** One pinch event of the pivot: `panBy(dx, dy)`, then `dolly` by the ratio's notches. */
function pinch(L: Lengths, p: Pivot, ratio: number, dx: number, dy: number) {
  const offset = new Float64Array(3),
    pan = new Float64Array(3)
  for (let k = 0; k < 3; k++) offset[k] = p.position[k] - p.center[k]
  const distance = L.l3(offset[0], offset[1], offset[2])
  panOffset(pan, p.q, dx, dy, pixelWorldScale(distance, 50, 400, 1))
  for (let k = 0; k < 3; k++) p.center[k] += pan[k]
  apply(L, p, offset)
  for (let k = 0; k < 3; k++) offset[k] = p.position[k] - p.center[k]
  const steps = ratio > 0 ? -Math.log(ratio) / Math.log(0.95) : 0,
    before = L.l3(offset[0], offset[1], offset[2]) || 1,
    after = dollyDistance(before, steps, 1)
  for (let k = 0; k < 3; k++) offset[k] = (offset[k] * after) / before
  apply(L, p, offset)
}

type Finger = { x: number; y: number }
/** `fixturePinch` through `trackPointers`: the first finger moves, then the second. */
function pinchGesture(L: Lengths, p: Pivot, from: [Finger, Finger], to: [Finger, Finger]) {
  const fingers = [{ ...from[0] }, { ...from[1] }]
  const gap = () => L.l2(fingers[0].x - fingers[1].x, fingers[0].y - fingers[1].y)
  let span = gap()
  for (let f = 0; f < 2; f++) {
    const beforeX = (fingers[0].x + fingers[1].x) / 2,
      beforeY = (fingers[0].y + fingers[1].y) / 2
    fingers[f] = { ...to[f] }
    const next = gap()
    const afterX = (fingers[0].x + fingers[1].x) / 2,
      afterY = (fingers[0].y + fingers[1].y) / 2
    pinch(L, p, span > 0 ? next / span : 1, afterX - beforeX, afterY - beforeY)
    span = next
  }
  return p
}

test('pivot and pinch: the pan and the dolly keep the camera pose in float32', () => {
  const finger = (i: number, a: number, b: number) => ({
    x: haltonSpan(i, a, 0, 1920),
    y: haltonSpan(i, b, 0, 1080),
  })
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const q = quaternion(i),
      eye = [0, 1, 2].map((k) => haltonSpan(i, [11, 13, 17][k], -1e3, 1e3)),
      center = [0, 1, 2].map((k) => haltonSpan(i, [19, 23, 29][k], -10, 10)),
      min = i % 3 ? 0 : haltonSpan(i, 31, 0, 50),
      max = i % 5 ? Infinity : haltonSpan(i, 37, 50, 2000)
    const from: [Finger, Finger] = [finger(i, 41, 43), finger(i, 47, 53)],
      to: [Finger, Finger] = [finger(i, 59, 61), finger(i, 67, 71)]
    const camera = fixtureCamera(eye[0], eye[1], eye[2]),
      surface = fixtureSurface(400),
      controls = createPanZoomCameraControls(camera, surface.element)
    camera.quaternion.set(q[0], q[1], q[2], q[3])
    controls.target.set(center[0], center[1], center[2])
    controls.minDistance = min
    controls.maxDistance = max
    fixturePinch(surface, from, to)
    const now = [camera.position.x, camera.position.y, camera.position.z]
    const state = (): Pivot => ({
      position: Float64Array.from(eye),
      center: Float64Array.from(center),
      q,
      min,
      max,
    })
    const ours = pinchGesture(NEW, state(), from, to),
      old = pinchGesture(OLD, state(), from, to)
    for (let k = 0; k < 3; k++) {
      assert.ok(Object.is(now[k], ours.position[k]), `oracle ${i}.${k}`)
      assertSameFloat32(old.position[k], now[k], `eye ${i}.${k}`)
      assertSameFloat32(old.center[k], ours.center[k], `pivot ${i}.${k}`)
    }
  }
})

test('character: the wish of every key chord has the same length', () => {
  // `axisOf` gives −1, 0 or 1 on each axis: nine chords, the whole input domain.
  for (const strafe of [-1, 0, 1])
    for (const advance of [-1, 0, 1])
      assert.ok(Object.is(length2(strafe, advance) || 1, hypot2(strafe, advance) || 1))
})
