import { createViewFingerprint } from './viewFingerprint.ts';
import type { EngineCamera } from './cameraWorld.ts';
import { bumpView, type FrameRevisions } from './frameRevisions.ts';

/**
 * Origin of the view revision. The camera is not written by the engine: the host hands it over
 * every frame. Comparing the sixteen view numbers and those of the projection, the resolution and
 * the quality threshold IS therefore the origin of the change, just as a `setTransform` is for the
 * scene — that is already what temporal Hi-Z does on its side (`sameHizView`).
 *
 * View, projection, near plane and viewport are the fingerprint common to both frame holds
 * (`viewFingerprint.ts`); far-plane range and the quality threshold belong only to this one.
 */
export function createViewRevision() {
  const fingerprint = createViewFingerprint();
  // `NaN` never equals `cam.far`: the first read always counts as a motion.
  let far = NaN,
    quality = NaN;
  return {
    /** Rereads this frame's view; increments `view` and returns true if any of these numbers moved. */
    read(
      revisions: FrameRevisions,
      cam: EngineCamera,
      viewportWidth: number,
      viewportHeight: number,
      pixelError: number,
    ) {
      // The camera pose, ancestors included, is the one frame entry has just copied: every entry
      // calls `readCameraWorld` before the adaptive threshold and before this read, and nothing
      // else enters here. That is the order the contract (`cameraWorld.ts`) guarantees, and it is
      // by this fingerprint alone that a pose decides to hold or replay a frame.
      if (
        far === cam.far &&
        quality === pixelError &&
        fingerprint.same(cam, viewportWidth, viewportHeight)
      )
        return false;
      fingerprint.keep(cam, viewportWidth, viewportHeight);
      far = cam.far;
      quality = pixelError;
      bumpView(revisions);
      return true;
    },
  };
}
