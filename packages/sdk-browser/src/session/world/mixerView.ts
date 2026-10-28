// The view a world's mixers hold their rigs in (`packages/sdk-core/src/world/animation/mixerHold.ts`):
// the camera's eye and axis, read when the mixers advance — after the controls moved it —, and its
// focal length on the canvas, so that a far rig keeps its pose only while every point of it stays
// within half a displayed pixel of its true pose.
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { viewScene } from '../../../../sdk-core/src/world/animation/mixerHold.ts'
import { cameraForward } from '../../camera/forward.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { focalPixels } from '../../../../math/src/projection/camera.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'

/** Registers the view of `camera()` on `canvas` for `scene`'s mixers, one object rewritten at
 *  each read; `null` while the camera's axis is undefined. */
export function worldMixerView(
  scene: Object3D,
  canvas: { width: number; height: number },
  camera: () => Camera,
) {
  const eye = [0, 0, 0],
    forward = [0, 0, -1]
  const view = { eye, forward, focal: 0, near: 0, perspective: 1 }
  viewScene(scene, () => {
    const lens = resolveCameraWorld(camera())
    const m = lens.matrixWorld.elements,
      back = length3(m[8], m[9], m[10])
    if (!(back > 0)) return null
    eye[0] = m[12]
    eye[1] = m[13]
    eye[2] = m[14]
    cameraForward(forward, m)
    view.focal = focalPixels(lens.projectionMatrix.elements, canvas.width, canvas.height)
    view.near = lens.near
    view.perspective = lens.projection === 'perspective' ? 1 : 0
    return view
  })
}
