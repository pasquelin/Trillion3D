// The camera's formulas moved to packages/math (#1493), each against its old expression, written
// here as the oracle, on HALTON_SWEEP points plus edges.
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
  haltonSpan,
} from '../../../math/src/sequence/sweep.fixture.ts'
import { createEngineCamera, writeEngineCamera, type CameraOptics } from './engineCamera.ts'
import { framingFromBounds } from './framing.ts'

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
