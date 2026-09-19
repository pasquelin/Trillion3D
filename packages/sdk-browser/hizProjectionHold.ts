import { createViewFingerprint } from './viewFingerprint.ts';
import type { EngineCamera } from './cameraWorld.ts';

/**
 * Which slots of the screen-rectangle table still describe this image, and which have to be
 * reprojected.
 *
 * A rectangle is a function of the box's world corners and of the view the image is drawn from, and
 * of nothing else. The corners are already held per page and rebuilt on their own epoch; this holds
 * the second half. The view is shared by every slot, so a camera that moved by a hair retires every
 * rectangle at once, and a view that did not move leaves each slot valid for as long as it keeps
 * pointing at the same page. What the caller then projects is the intersection of what it asks for
 * with what is not current — the same rectangles, written by the same arithmetic, for the slots that
 * need them.
 */
export function createProjectionHold(slots: number) {
  const size = Math.max(1, slots);
  const stamp = new Int32Array(size).fill(-1),
    heldPage = new Int32Array(size).fill(-1),
    pending = new Uint8Array(size);
  // View, projection, near plane, viewport and world revision: everything a screen rectangle
  // depends on besides the box itself. The first four are the fingerprint that Three engines'
  // view revision also compares (`viewFingerprint.ts`); the table age is ours alone.
  const fingerprint = createViewFingerprint();
  let generation = 0,
    heldEpoch = -1;
  return {
    pending,
    /**
     * Age of the screen rectangles: it changes as soon as the view, the viewport or the table
     * age retires the held rectangles. What anyone who keeps PROJECTED bounds reads, and must
     * know whether they still describe this frame.
     */
    get generation() {
      return generation;
    },
    /**
     * Rereads the view every slot shares; a change retires every rectangle at once. The view
     * comes from the engine camera, which the frame entry copied by THE CONTRACT
     * (`cameraWorld.ts`): under a host rig, a camera of which only an ancestor moved has no new
     * local pose, and the fingerprint would see nothing move if the chain were not resolved
     * first. The cache would be held wrongly and the Hi-Z test would receive the previous
     * view's rectangles.
     */
    reframe(cam: EngineCamera, width: number, height: number, epoch: number) {
      if (heldEpoch === epoch && fingerprint.same(cam, width, height)) return;
      fingerprint.keep(cam, width, height);
      heldEpoch = epoch;
      generation++;
    },
    /**
     * Marks the slots the caller must project — those it asks for whose rectangle is not that of
     * this view — and returns HOW MANY there are. The mask is the caller's `only` argument; zero
     * means the cache already describes this frame.
     */
    select(count: number, only: Uint8Array | undefined, pageIndex: Int32Array) {
      let besoin = 0;
      for (let i = 0; i < count; i++) {
        const need =
          (!only || only[i] !== 0) && (stamp[i] !== generation || heldPage[i] !== pageIndex[i])
            ? 1
            : 0;
        pending[i] = need;
        besoin += need;
      }
      return besoin;
    },
    /** Records the rectangles the caller has just written. */
    keep(count: number, pageIndex: Int32Array) {
      for (let i = 0; i < count; i++)
        if (pending[i]) {
          stamp[i] = generation;
          heldPage[i] = pageIndex[i];
        }
    },
    /** Retires every rectangle: the table they describe is gone. */
    invalidate() {
      generation++;
    },
  };
}
