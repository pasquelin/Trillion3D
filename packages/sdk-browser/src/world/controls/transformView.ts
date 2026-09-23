import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';

const eye = new Vector3(),
  ahead = new Vector3();

/**
 * The world length that spans `share` of the canvas height at `point`, as `camera` draws it:
 * what keeps handles one screen size wherever their object stands. A perspective view grows with
 * the depth of the point along the view; an orthographic one is its box, whatever the depth.
 */
export function handleScreenSize(camera: Camera, point: Vector3, share: number) {
  if (camera.projection === 'orthographic')
    return ((camera.top - camera.bottom) / camera.zoom) * share;
  camera.getWorldPosition(eye);
  camera.getWorldDirection(ahead);
  const depth = Math.max(ahead.dot(point) - ahead.dot(eye), camera.near);
  return ((2 * depth * Math.tan((camera.fov * Math.PI) / 360)) / camera.zoom) * share;
}
