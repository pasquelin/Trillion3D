import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { xrPose } from './input.ts';
import type { XrView } from './platform.ts';

class EyeCamera extends Camera {
  readonly lens = new Matrix4();
  override get projectionMatrix() {
    return this.lens;
  }
}

/** An eye's asymmetric lens uses the existing tiled projection path, including its frustum and
 *  pixel error. Depth keeps the engine's reversed convention; the browser owns the lens and pose. */
export function createXrCamera() {
  const camera = Object.assign(new EyeCamera('perspective'), {
    viewTile: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 },
  });
  return {
    camera,
    update(view: XrView, width: number, height: number, webgpu = false) {
      const p = view.projectionMatrix;
      if (p.length !== 16 || !p.every(Number.isFinite) || p[0] <= 0 || p[5] <= 0 || p[11] !== -1)
        throw new Error('XR_PROJECTION: the runtime did not supply a finite perspective lens');
      camera.lens.fromArray(p);
      camera.near = p[14] / (webgpu ? p[10] : p[10] - 1);
      camera.far = p[10] === -1 ? Infinity : p[14] / (p[10] + 1);
      if (!(camera.near > 0 && camera.far > camera.near))
        throw new Error('XR_PROJECTION: invalid eye depth range');
      camera.fov = (2 * Math.atan(1 / p[5]) * 180) / Math.PI;
      camera.aspect = width / height;
      Object.assign(camera.viewTile, {
        scaleX: (p[0] * camera.aspect) / p[5],
        scaleY: 1,
        offsetX: p[8],
        offsetY: p[9],
      });
      xrPose(camera, view.transform);
      return camera;
    },
  };
}
