// The view a world's mixers hold their rigs in (`packages/sdk-core/src/world/animation/mixerHold.ts`):
// the camera's eye and axis, read when the mixers advance — after the controls moved it —, and its
// focal length on the canvas, so that a far rig keeps its pose only while every point of it stays
// within half a displayed pixel of its true pose.
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { viewScene } from '../../../../sdk-core/src/world/animation/mixerHold.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';

/** Registers the view of `camera()` on `canvas` for `scene`'s mixers, one object rewritten at
 *  each read; `null` while the camera's axis is undefined. */
export function worldMixerView(
  scene: Object3D,
  canvas: { width: number; height: number },
  camera: () => Camera,
) {
  const eye = [0, 0, 0],
    forward = [0, 0, -1],
    viewport = [1, 1],
    scale = [0, 0];
  const view = { eye, forward, focal: 0, near: 0, perspective: 1 };
  viewScene(scene, () => {
    const lens = camera();
    lens.updateMatrixWorld();
    const m = lens.matrixWorld.elements,
      back = Math.hypot(m[8], m[9], m[10]);
    if (!(back > 0)) return null;
    eye[0] = m[12];
    eye[1] = m[13];
    eye[2] = m[14];
    forward[0] = -m[8] / back;
    forward[1] = -m[9] / back;
    forward[2] = -m[10] / back;
    viewport[0] = canvas.width;
    viewport[1] = canvas.height;
    pixelScaleOf(lens.projectionMatrix.elements, viewport, scale);
    view.focal = Math.max(scale[0], scale[1]);
    view.near = lens.near;
    view.perspective = lens.projection === 'perspective' ? 1 : 0;
    return view;
  });
}
