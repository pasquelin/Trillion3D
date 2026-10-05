import type { Matrix4 } from '../math/matrix4.ts';
import type { Camera } from './camera.ts';
import { drawnView, perspectiveSlope } from '../../math/primitives/camera.ts';

const view = new Float64Array(4);

/**
 * Writes into `out` the projection carrying `camera`'s view volume onto the clip cube, its far
 * plane finite: x and y from −1 to 1 across the picture, depth from −1 on the near plane to 1 on
 * the far one. The world draws with its own, depth reversed onto [0, 1] (`engineCamera.ts`); this
 * is the matrix a renderer reads as `camera.projectionMatrix`.
 *
 * Orthographic: the box (`drawnView`) brought onto [−1, 1] on each axis. Perspective: x and y
 * scaled by near / h, h the half extent of the near-plane rectangle; depth −1 on the near plane
 * and +1 on the far one.
 *
 * The order of operations is imposed by the bench's parity test. For every optic with a positive
 * finite aspect, zoom, fov in (0, 180) and 0 < near < far, finite and not overflowing, the matrix
 * is bit-identical to the one this file held before its derivation (`referenceProjection.test.ts`
 * pins it); outside it the entries are not defined (NaN or ±Infinity either way).
 */
export function referenceProjection(out: Matrix4, camera: Camera) {
  const { near, far, zoom } = camera;
  if (camera.projection === 'orthographic') {
    const [cx, cy, hx, hy] = drawnView(camera, camera.aspect, zoom, view);
    const x0 = cx - hx,
      x1 = cx + hx,
      y0 = cy - hy,
      y1 = cy + hy;
    const kx = 1 / (x1 - x0),
      ky = 1 / (y1 - y0),
      kz = 1 / (far - near);
    // prettier-ignore
    return out.set(
      2 * kx, 0, 0, -(x0 + x1) * kx,
      0, 2 * ky, 0, -(y0 + y1) * ky,
      0, 0, -2 * kz, -(near + far) * kz,
      0, 0, 0, 1,
    );
  }
  const hy = (near * perspectiveSlope(camera.fov)) / zoom,
    hx = camera.aspect * hy,
    span = near - far;
  // prettier-ignore
  return out.set(
    near / hx, 0, 0, 0,
    0, near / hy, 0, 0,
    0, 0, (near + far) / span, (2 * far * near) / span,
    0, 0, -1, 0,
  );
}
