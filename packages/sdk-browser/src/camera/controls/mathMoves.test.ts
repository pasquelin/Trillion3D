// The pivot's lengths moved from `hypot2`/`hypot3` to `length2`/`length3` (#1493): each pinch
// is replayed by an oracle that takes its lengths as a parameter. Run with the new ones it gives
// the controller's own pose bit for bit, which proves the oracle is the controller; run with the
// old ones, the same pose once in float32 — after one gesture, and at every step of a chain of
// gestures on one controller, where the eye and the pivot carry their doubles from one to the
// next, on HALTON_SWEEP points. The head's are in `mathMovesLook.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hypot2 } from '../../../../math/src/float/hypot.ts'
import { length2 } from '../../../../math/src/vector/vector.ts'
import { clampCompare } from '../../../../math/src/scalar/reals.ts'
import { RADIUS_EPSILON } from '../../../../math/src/vector/spherical.ts'
import { rotateByQuaternion } from '../../../../math/src/quaternion/quaternion.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  haltonSpan,
} from '../../../../math/src/sequence/sweep.fixture.ts'
import { dollyDistance, panOffset, pixelWorldScale } from './math.ts'
import { createPanZoomCameraControls } from './panZoomControls.ts'
import { fixtureCamera, fixturePinch, fixtureSurface } from './controls.fixture.ts'
import { NEW, OLD, quaternion, type Lengths } from './mathMoves.fixture.ts'

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

const finger = (i: number, a: number, b: number) => ({
  x: haltonSpan(i, a, 0, 1920),
  y: haltonSpan(i, b, 0, 1080),
})

/** Sweep point `i`'s pivot controller, its pose and limits, with two oracles of its state. */
function pivotCase(i: number) {
  const q = quaternion(i),
    eye = [0, 1, 2].map((k) => haltonSpan(i, [11, 13, 17][k], -1e3, 1e3)),
    center = [0, 1, 2].map((k) => haltonSpan(i, [19, 23, 29][k], -10, 10)),
    min = i % 3 ? 0 : haltonSpan(i, 31, 0, 50),
    max = i % 5 ? Infinity : haltonSpan(i, 37, 50, 2000)
  const camera = fixtureCamera(eye[0], eye[1], eye[2]),
    surface = fixtureSurface(400),
    controls = createPanZoomCameraControls(camera, surface.element)
  camera.quaternion.set(q[0], q[1], q[2], q[3])
  controls.target.set(center[0], center[1], center[2])
  controls.minDistance = min
  controls.maxDistance = max
  const state = (): Pivot => ({
    position: Float64Array.from(eye),
    center: Float64Array.from(center),
    q,
    min,
    max,
  })
  return { camera, surface, ours: state(), old: state() }
}

/** Gesture `g`'s pinch on the controller and both oracles, then the pose against them. */
function assertPinch(c: ReturnType<typeof pivotCase>, g: number, at: string) {
  const from: [Finger, Finger] = [finger(g, 41, 43), finger(g, 47, 53)],
    to: [Finger, Finger] = [finger(g, 59, 61), finger(g, 67, 71)]
  fixturePinch(c.surface, from, to)
  pinchGesture(NEW, c.ours, from, to)
  pinchGesture(OLD, c.old, from, to)
  const now = [c.camera.position.x, c.camera.position.y, c.camera.position.z]
  for (let k = 0; k < 3; k++) {
    assert.ok(Object.is(now[k], c.ours.position[k]), `oracle ${at}.${k}`)
    assertSameFloat32(c.old.position[k], now[k], `eye ${at}.${k}`)
    assertSameFloat32(c.old.center[k], c.ours.center[k], `pivot ${at}.${k}`)
  }
}

test('pivot and pinch: the pan and the dolly keep the camera pose in float32', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) assertPinch(pivotCase(i), i, `${i}`)
})

test('pivot and pinch: a chain of 12 gestures keeps the camera pose in float32 at every step', () => {
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const c = pivotCase(i)
    for (let s = 1; s <= 12; s++) assertPinch(c, i * 12 + s, `${i} step ${s}`)
  }
})

test('character: the wish of every key chord has the same length', () => {
  // `axisOf` gives −1, 0 or 1 on each axis: nine chords, the whole input domain.
  for (const strafe of [-1, 0, 1])
    for (const advance of [-1, 0, 1])
      assert.ok(Object.is(length2(strafe, advance) || 1, hypot2(strafe, advance) || 1))
})
