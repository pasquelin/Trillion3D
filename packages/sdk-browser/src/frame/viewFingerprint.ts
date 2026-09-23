import { copyElements, sameElements } from '../math/matrixElements.ts';
import type { EngineCamera } from '../camera/world.ts';

/**
 * Fingerprint of an image view: the sixteen numbers of the view, the sixteen of the projection,
 * the near plane and the viewport. Two holds used to compare exactly that and copy it each for
 * their own — the view revision of the engines rendered by Three (`viewRevision.ts`) and the
 * hold of the Hi-Z screen rectangles (`../hiz/projectionHold.ts`) — with two `Float64Array(16)` and
 * the same sequence of comparisons. A single write; what distinguishes one hold from the other,
 * far-plane range and quality threshold on one side, table age on the other, stays with it.
 *
 * No tolerance, and nothing that is read anywhere but on the engine camera: a view that moved by
 * one last bit is a different view.
 */
export function createViewFingerprint() {
  const view = new Float64Array(16),
    projection = new Float64Array(16);
  // Nothing is held yet: `NaN` does not equal itself, so the first image differs.
  let near = NaN,
    width = -1,
    height = -1;
  return {
    /** True when the view, the projection, the near plane and the viewport are those already held. */
    same(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      return (
        near === cam.near &&
        width === viewportWidth &&
        height === viewportHeight &&
        sameElements(view, cam.view) &&
        sameElements(projection, cam.projection)
      );
    },
    /** Holds this view, without allocating anything. */
    keep(cam: EngineCamera, viewportWidth: number, viewportHeight: number) {
      copyElements(view, cam.view);
      copyElements(projection, cam.projection);
      near = cam.near;
      width = viewportWidth;
      height = viewportHeight;
    },
  };
}
