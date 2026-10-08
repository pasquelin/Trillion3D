import test from 'node:test'
import assert from 'node:assert/strict'
import { camera, type CameraParameters } from './index.ts'
import {
  drawnView,
  orthographicProjection,
  perspectiveProjection,
} from '../../../../math/src/projection/camera.ts'

/** Optics across the valid range (`referenceProjection.ts`): positive finite aspect, zoom, fov in
 *  (0, 180) and 0 < near < far, the box centred or off its axis, flipped, fitted or not. */
const PERSPECTIVE: CameraParameters[] = [
  {},
  { fov: 47, aspect: 1.6, near: 0.3, far: 900, zoom: 1.5 },
  { fov: 90, aspect: 1, near: 2, far: 50 },
  { fov: 1e-3, aspect: 2.35, near: 1, far: 1e9 },
  { fov: 179.5, aspect: 1.25, near: 0.001, far: 10 },
  { fov: 65, aspect: 2, near: 1e-30, far: 1e30, zoom: 1e-3 },
  { fov: 100, aspect: 0.4, near: 0.15, far: 150.15, zoom: 0.333 },
]
const ORTHOGRAPHIC: CameraParameters[] = [
  {},
  { left: -3, right: 5, top: 2, bottom: -1, near: 0.1, far: 40 },
  { top: 7.5, bottom: -7.5, near: 0.5, far: 300, zoom: 2.5, aspect: 1.6, fitAspect: true },
  { left: 0, right: 1920, top: 0, bottom: 1080, near: 0.1, far: 100 },
  { left: -1e-3, right: 1e-3, top: 1e-3, bottom: -1e-3, near: 1e-5, far: 1e5, zoom: 1e3 },
]

/** The engine's own projection of the same optics, composed apart. */
function engineProjection(eye: ReturnType<typeof camera.perspective>) {
  const out = new Float64Array(16)
  if (eye.projection === 'perspective')
    return perspectiveProjection(out, eye.fov, eye.aspect, eye.near, eye.zoom)
  const [x, y, w, h] = drawnView(eye, eye.aspect, eye.zoom)
  return orthographicProjection(out, x - w, x + w, y - h, y + h, eye.near, eye.far)
}

/** Clip depth over clip w of the view point `(0, 0, z)`. */
const depthAt = (m: ArrayLike<number>, z: number) => (m[10] * z + m[14]) / (m[11] * z + m[15])

for (const [projection, all] of [
  ['perspective', PERSPECTIVE],
  ['orthographic', ORTHOGRAPHIC],
] as const)
  test(`a ${projection} camera composes the engine's projection, fresh or rewritten in place`, () => {
    for (const optics of all) {
      const fresh = camera[projection](optics)
      // The same optics written after a first read recompose the matrix read, in place.
      const written = camera[projection]()
      const matrix = written.projectionMatrix
      Object.assign(written, optics)
      assert.equal(written.projectionMatrix, matrix)
      for (const eye of [fresh, written])
        assert.deepEqual([...eye.projectionMatrix.elements], [...engineProjection(eye)])
    }
  })

test('the depth is reversed onto [0, 1]: 1 on the near plane, 0 at the far end', () => {
  const lens = camera.perspective({ near: 0.5, far: 80 }).projectionMatrix.elements
  assert.ok(Math.abs(depthAt(lens, -0.5) - 1) < 1e-12, 'the near plane')
  assert.ok(depthAt(lens, -1e12) < 1e-12 && depthAt(lens, -1e12) > 0, 'infinity, never reached')
  const box = camera.orthographic({ near: 0.5, far: 80 }).projectionMatrix.elements
  assert.ok(Math.abs(depthAt(box, -0.5) - 1) < 1e-12, 'the near plane')
  assert.ok(Math.abs(depthAt(box, -80)) < 1e-12, 'the far plane')
})
