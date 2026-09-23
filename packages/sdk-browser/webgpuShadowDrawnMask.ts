import { forEachShadowFace } from '../sdk-core/src/index.ts';
import type { WebgpuLightState } from './webgpuPagesStateLights.ts';

/**
 * Held-page masks of the faces whose mask or wrap origin changed since the last frame, into
 * the slice mirror, after the frame's scheduling: the pages that hold a depth of the face's
 * extent, not the complement of the stale mask — a page awaiting a redraw still holds one —,
 * and the physical page of the extent origin. The two words are the held rows read four by
 * four (`sceneLightShadowHeld.ts`). A face whose words changed flags its slice to push even
 * when nothing was drawn in it: an extent that slid has a strip the read must fall through,
 * and only the slice buffer can tell it so.
 */
export function writeDrawnMasks(lights: WebgpuLightState) {
  const { store, plan, shadows } = lights,
    { dirty } = plan.slices;
  if (!shadows) return;
  forEachShadowFace(store, (_slot, slice, face) => {
    if (!dirty.heldChanged(slice, face)) return;
    shadows.writeDrawnMask(
      slice,
      face,
      dirty.heldWord(slice, face, 0),
      dirty.heldWord(slice, face, 1),
      dirty.wrapXOf(slice, face),
      dirty.wrapYOf(slice, face),
    );
  });
}
