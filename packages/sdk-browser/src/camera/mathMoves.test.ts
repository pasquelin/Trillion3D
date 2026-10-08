// The camera's formulas moved to packages/math (#1493), each against its old expression, written
// here as the oracle, on HALTON_SWEEP points plus edges.
//
// Code argument (a), `readCameraMotion`'s turn: the cross and dot products of the way back are
// `crossVector3` and `dotVector3`, the same terms in the same order; its length moves from `hypot3`
// to `length3`, and its axis is multiplied by `1 / length` rather than divided by it. The turn rate
// and its axis feed the view ahead (`../gpu/core/aheadView.ts`) alone, the prefetch of pages, never
// a pixel. Only the decision "the view turned" (`sin > 0`) could matter; the sweep below finds it
// the same, and the two lengths part at zero only for a turn below about 1e-162 radians per frame,
// the underflow of `length3`'s squares.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { normalizeQuaternion } from '../../../math/src/quaternion/quaternion.ts'
import { composeMatrix4 } from '../../../math/src/matrix/matrix4Compose.ts'
import {
  drawnView,
  orthographicProjection,
  perspectiveProjection,
} from '../../../math/src/projection/camera.ts'
import {
  HALTON_SWEEP,
  assertSameFloat32,
  edgeValues,
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'
import { adaptivePixelError } from '../../../sdk-core/src/index.ts'
import { createEngineCamera, writeEngineCamera, type CameraOptics } from './engineCamera.ts'
import { readCameraMotion, type CameraMotion } from './motion.ts'
import { framingFromBounds } from './framing.ts'

/** The `i`-th Halton unit direction, from the bases `a` (azimuth) and `b` (height). */
function direction(out: Float64Array, i: number, a: number, b: number) {
  const angle = haltonSpan(i, a, -Math.PI, Math.PI),
    z = haltonSpan(i, b, -1, 1),
    r = Math.sqrt(1 - z * z)
  out[0] = r * Math.cos(angle)
  out[1] = r * Math.sin(angle)
  out[2] = z
  return out
}

test('readCameraMotion: the turn and its speed decide as before', () => {
  const back = new Float64Array(3),
    way = new Float64Array(3),
    cam = createEngineCamera()
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    direction(back, i, 2, 3)
    if (i % 8) direction(way, i, 5, 7)
    else way.set(back) // the same way back: no turn at all
    const sin = hypot3(
      back[1] * way[2] - back[2] * way[1],
      back[2] * way[0] - back[0] * way[2],
      back[0] * way[1] - back[1] * way[0],
    )
    // The camera moved from the eye at the origin, looking back along `back`, to `way` after 16 ms.
    const motion: CameraMotion = {
      last: new Float64Array(3),
      lastBack: back.slice(),
      lastMs: 0,
    }
    for (let k = 0; k < 3; k++) cam.eye[k] = haltonSpan(i, [11, 13, 17][k], -2000, 2000)
    cam.view[2] = way[0]
    cam.view[6] = way[1]
    cam.view[10] = way[2]
    const speed = readCameraMotion(cam, motion, 16)
    assert.equal(motion.turn! > 0, sin > 0, `turn decision ${i}`)
    // The speed reaches the cut's pixel error, a float32 uniform (`../gpu/dag/viewLayout.ts`).
    const v = motion.velocity!
    const old = hypot3(v[0], v[1], v[2])
    for (const radius of [1, 50, 4000])
      assertSameFloat32(
        adaptivePixelError(1, old, radius),
        adaptivePixelError(1, speed, radius),
        `pixel error ${i}`,
      )
  }
})

test('readCameraMotion: the speed at the edges', () => {
  const cam = createEngineCamera()
  for (const x of edgeValues(-1e30, 1e30)) {
    const motion: CameraMotion = {
      last: new Float64Array(3),
      lastBack: new Float64Array(3),
      lastMs: 0,
    }
    cam.eye.set([x, -x / 3, x * 0.7])
    const speed = readCameraMotion(cam, motion, 1000)
    const v = motion.velocity!
    for (const radius of [1, 4000])
      assertSameFloat32(
        adaptivePixelError(1, hypot3(v[0], v[1], v[2]), radius),
        adaptivePixelError(1, speed, radius),
        `edge ${x}`,
      )
  }
})

/** `applyViewTile` as it was: the scales on the diagonal, the shifts on the column w reads. */
function oldTile(p: Float64Array, tile: NonNullable<CameraOptics['viewTile']>, ortho: boolean) {
  p[0] *= tile.scaleX
  p[5] *= tile.scaleY
  if (ortho) {
    p[12] = p[12] * tile.scaleX - tile.offsetX
    p[13] = p[13] * tile.scaleY - tile.offsetY
  } else {
    p[8] = p[8] * tile.scaleX + tile.offsetX
    p[9] = p[9] * tile.scaleY + tile.offsetY
  }
}

test('writeEngineCamera: a view tile is the clip window, every entry bit for bit', () => {
  const cam = createEngineCamera(),
    expected = new Float64Array(16)
  cam.world.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    const s = haltonSpan(i, 2, 1, 64),
      viewTile = {
        scaleX: s,
        scaleY: s,
        offsetX: haltonSpan(i, 3, -s, s),
        offsetY: haltonSpan(i, 5, -s, s),
      }
    const fov = haltonSpan(i, 7, 10, 120),
      aspect = haltonSpan(i, 11, 0.25, 4),
      ortho = i % 2 === 0
    const box = { left: -aspect, right: aspect * 1.5, top: 1, bottom: -0.5 }
    const optics = { fov, aspect, near: 0.1, far: 500, zoom: 1, viewTile }
    writeEngineCamera(cam, ortho ? { ...optics, orthographic: box } : optics)
    if (ortho) {
      const [x, y, hw, hh] = drawnView(box, aspect, 1)
      orthographicProjection(expected, x - hw, x + hw, y - hh, y + hh, 0.1, 500)
    } else perspectiveProjection(expected, fov, aspect, 0.1, 1)
    oldTile(expected, viewTile, ortho)
    for (let k = 0; k < 16; k++)
      assert.ok(Object.is(cam.projection[k], expected[k]), `tile ${i} entry ${k}`)
  }
})

test('writeEngineCamera: the orthographic view point keeps its float32', () => {
  const cam = createEngineCamera(),
    q = new Float64Array(4),
    at = new Float64Array(3),
    scale = new Float64Array(3)
  const box = { left: -1, right: 1, top: 1, bottom: -1 }
  for (let i = 1; i <= HALTON_SWEEP; i++) {
    for (let k = 0; k < 4; k++) q[k] = haltonSpan(i, [2, 3, 5, 7][k], -1, 1)
    normalizeQuaternion(q)
    for (let k = 0; k < 3; k++) {
      at[k] = haltonSpan(i, [11, 13, 17][k], -1e4, 1e4)
      scale[k] = 2 ** haltonSpan(i, [19, 23, 29][k], -10, 10)
    }
    composeMatrix4(cam.world, at, q, scale)
    writeEngineCamera(cam, { fov: 50, aspect: 1, near: 0.1, far: 500, zoom: 1, orthographic: box })
    const w = cam.world,
      flat = 1 / (hypot3(w[8], w[9], w[10]) || 1)
    for (let k = 0; k < 3; k++)
      assertSameFloat32(cam.eye[k] * 0 + w[8 + k] * flat, cam.viewPoint[k], `view point ${i}.${k}`)
  }
})

test('framingFromBounds: its fixed direction has the same length', () => {
  assert.ok(Object.is(length3(0.85, 0.65, 1), hypot3(0.85, 0.65, 1)))
  const framed = framingFromBounds(3, 1.5)
  assert.ok(Object.is(framed.offset[2], (3 * 1.9) / hypot3(0.85, 0.65, 1)))
})
