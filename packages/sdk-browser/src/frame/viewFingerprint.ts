import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import type { EngineCamera } from '../camera/world.ts'

/**
 * Fingerprint of an image view: the sixteen numbers of the view, the sixteen of the projection
 * (unjittered: the antialiasing jitter lives on its own render matrix), the near plane and the
 * viewport, compared exactly and copied with two `Float64Array(16)` for the view revision
 * (`viewRevision.ts`), whose motion the occluder history also takes; what belongs to that hold
 * alone, far-plane range and quality threshold, stays with it.
 *
 * No tolerance, and nothing that is read anywhere but on the engine camera: a view that moved by
 * one last bit is a different view.
 */
export function createViewFingerprint() {
  const view = new Float64Array(16),
    projection = new Float64Array(16)
  // Nothing is held yet: `NaN` does not equal itself, so the first image differs.
  let near = NaN,
    width = -1,
    height = -1
  return {
    /** True when the view, the projection, the near plane and the viewport are those already held. */
    same(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      return (
        near === cam.near &&
        width === viewportWidth &&
        height === viewportHeight &&
        sameElements(view, cam.view) &&
        sameElements(projection, cam.projection)
      )
    },
    /** Holds this view, without allocating anything. */
    keep(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      copyMatrix4(view, cam.view)
      copyMatrix4(projection, cam.projection)
      near = cam.near
      width = viewportWidth
      height = viewportHeight
    },
  }
}
