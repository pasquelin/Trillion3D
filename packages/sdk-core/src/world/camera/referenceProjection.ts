import type { Matrix4 } from '../math/matrix4.ts';
import type { Camera } from './camera.ts';
import { orthographicView, perspectiveSlope } from '../../math/primitives/camera.ts';

const view = new Float64Array(4);

/**
 * Writes into `out` the projection a renderer drawing with `camera`'s optics composes, in the
 * reference's depth convention with a finite far plane, number for number. The world composes
 * its own (`engineCamera.ts`): this one is for a draw that keeps the reference's convention.
 */
export function referenceProjection(out: Matrix4, camera: Camera) {
  const { near, far, zoom } = camera;
  if (camera.projection === 'orthographic') {
    const [cx, cy, dx, dy] = orthographicView(camera, zoom, view);
    const left = cx - dx,
      right = cx + dx,
      top = cy + dy,
      bottom = cy - dy;
    const w = 1.0 / (right - left),
      h = 1.0 / (top - bottom),
      p = 1.0 / (far - near);
    // prettier-ignore
    return out.set(
      2 * w, 0, 0, -(right + left) * w,
      0, 2 * h, 0, -(top + bottom) * h,
      0, 0, -2 * p, -(far + near) * p,
      0, 0, 0, 1,
    );
  }
  const top = (near * perspectiveSlope(camera.fov)) / zoom;
  const height = 2 * top,
    width = camera.aspect * height;
  const left = -0.5 * width;
  const right = left + width,
    bottom = top - height;
  const x = (2 * near) / (right - left),
    y = (2 * near) / (top - bottom);
  const a = (right + left) / (right - left),
    b = (top + bottom) / (top - bottom);
  const c = -(far + near) / (far - near),
    d = (-2 * far * near) / (far - near);
  // prettier-ignore
  return out.set(
    x, 0, a, 0,
    0, y, b, 0,
    0, 0, c, d,
    0, 0, -1, 0,
  );
}
