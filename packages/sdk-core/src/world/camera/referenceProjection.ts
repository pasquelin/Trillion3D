import type { Matrix4 } from '../math/matrix4.ts'
import type { Camera } from './camera.ts'
import {
  drawnView,
  orthographicProjection,
  perspectiveProjection,
} from '../../../../math/src/projection/camera.ts'

const view = new Float64Array(4)

/** The box an orthographic camera sees, in its own frame, before its zoom. */
type ProjectionBox = Parameters<typeof drawnView>[0]

/**
 * Writes into `out` the projection the optics compose, the engine's own: x and y from −1 to 1
 * across the picture, depth reversed onto [0, 1] — 1 on the near plane, 0 at infinity for a
 * perspective camera (`perspectiveProjection`) and on the far plane for an orthographic one, whose
 * `box` is the one it draws at its picture's shape (`drawnView`, `orthographicProjection`). A
 * null `box` makes the projection perspective. Nothing is allocated.
 */
export function opticsProjection(
  out: Float64Array,
  fov: number,
  aspect: number,
  near: number,
  far: number,
  zoom: number,
  box: ProjectionBox | null | undefined,
) {
  if (box) {
    const [x, y, w, h] = drawnView(box, aspect, zoom, view)
    orthographicProjection(out, x - w, x + w, y - h, y + h, near, far)
  } else perspectiveProjection(out, fov, aspect, near, zoom)
  return out
}

/**
 * `camera`'s projection (`opticsProjection`): the matrix a reader of `camera.projectionMatrix`
 * gets, the very doubles the engine draws with.
 */
export function referenceProjection(out: Matrix4, camera: Camera) {
  const { fov, aspect, near, far, zoom } = camera
  const box = camera.projection === 'orthographic' ? camera : null
  opticsProjection(out.elements, fov, aspect, near, far, zoom, box)
  return out
}
