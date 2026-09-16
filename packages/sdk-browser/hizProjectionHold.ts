import type * as THREE from 'three';
import { copyElements, sameElements } from './matrixElements.ts';

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
  // Vue, projection, plan proche, viewport et révision du monde : tout ce dont un rectangle d'écran
  // dépend en dehors de la boîte elle-même.
  const view = new Float64Array(16),
    projection = new Float64Array(16);
  let generation = 0,
    heldNear = NaN,
    heldWidth = -1,
    heldHeight = -1,
    heldEpoch = -1;
  return {
    pending,
    /** Re-reads the view every slot shares; a change retires every rectangle at once. */
    reframe(camera: THREE.PerspectiveCamera, width: number, height: number, epoch: number) {
      camera.updateWorldMatrix(true, false);
      const now = camera.matrixWorldInverse.elements,
        nowProjection = camera.projectionMatrix.elements;
      if (
        heldNear === camera.near &&
        heldWidth === width &&
        heldHeight === height &&
        heldEpoch === epoch &&
        sameElements(view, now) &&
        sameElements(projection, nowProjection)
      )
        return;
      copyElements(view, now);
      copyElements(projection, nowProjection);
      heldNear = camera.near;
      heldWidth = width;
      heldHeight = height;
      heldEpoch = epoch;
      generation++;
    },
    /**
     * Marks the slots the caller must project — those it asks for whose rectangle is not the current
     * one — and answers whether there is any. The mask is the caller's `only` argument.
     */
    select(count: number, only: Uint8Array | undefined, pageIndex: Int32Array) {
      let any = 0;
      for (let i = 0; i < count; i++) {
        const need =
          (!only || only[i] !== 0) && (stamp[i] !== generation || heldPage[i] !== pageIndex[i])
            ? 1
            : 0;
        pending[i] = need;
        any |= need;
      }
      return any !== 0;
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
