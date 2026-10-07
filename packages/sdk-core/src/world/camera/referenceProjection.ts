import type { Matrix4 } from '../math/matrix4.ts'
import type { Camera } from './camera.ts'
import {
  drawnView,
  orthographicProjection,
  perspectiveProjection,
} from '../../math/primitives/camera.ts'

const view = new Float64Array(4)

/**
 * Writes into `out` the projection `camera`'s optics compose, the engine's own: x and y from −1
 * to 1 across the picture, depth reversed onto [0, 1] — 1 on the near plane, 0 at infinity for a
 * perspective camera (`perspectiveProjection`) and on the far plane for an orthographic one, whose
 * box is the one it draws at its picture's shape (`drawnView`, `orthographicProjection`). It is
 * the matrix a reader of `camera.projectionMatrix` gets, the very doubles the engine draws with.
 */
export function referenceProjection(out: Matrix4, camera: Camera) {
  const { near, far, zoom } = camera
  if (camera.projection === 'orthographic') {
    const [x, y, w, h] = drawnView(camera, camera.aspect, zoom, view)
    orthographicProjection(out.elements, x - w, x + w, y - h, y + h, near, far)
  } else perspectiveProjection(out.elements, camera.fov, camera.aspect, near, zoom)
  return out
}
