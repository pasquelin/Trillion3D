import { sameRenderOrigin } from '../../../camera/renderOrigin.ts';
import { rootTranslationsToRenderOrigin, rootWorldsToRenderOrigin } from '../../../gpu/dag/pack.ts';
import { invalidateOccluderHistory } from '../io/drops.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import { followHostVisibility } from '../../../placement/hidden.ts';
import { flipWorld } from '../../../placement/webgpuPlacements.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The scene revision whose worlds a buffer last received whole: an image at the same revision
 *  only moved the eye, and rewrites the three translation numbers of each root alone. */
const fullyRebased = new WeakMap<Float32Array, number>();

/**
 * Brings the scene's world matrices to the image. A world matrix is a function of the scene alone:
 * an image that nothing touched would find them all identical. The engine index is therefore only
 * recomputed at a scene-revision change, and a node that `setWebgpuTransform` just moved has
 * already recomputed it — and rewritten its own rows (`movedRoot.ts`). Only a host write, whose
 * moved roots nobody named, walks it here, and then rewrites every row, whichever cut draws the
 * image: the GPU cut and the CPU fallback read the same table. Returns whether the poses moved.
 */
export function uploadWorlds(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const { run } = rt,
    { selectionRoots, worldUpdates, rows } = rt.layout;
  const hostWalked = run.gate.updateWorlds(rt.setup.worlds);
  // A node the host hid or showed parks its roots and hides its blend items, or takes them back,
  // in every cut, and one set to cast or not leaves or enters every light cut; the shadow pages its
  // roots covered are drawn again, static casters included unless every root that flipped was
  // moving already: the static layer never held those (`../../shadow/mobility.ts`, #990).
  if (hostWalked) {
    const flipped = followHostVisibility(
      selectionRoots,
      { entries: rt.blendState.blendGpu, sourceOf: (item) => item.sourceMesh },
      flipWorld(rt),
      rt.lights.mobility.moves,
    );
    if (flipped) rt.lights.plan.worldChanged(flipped.min, flipped.max, flipped.movingOnly);
  }
  const worldsMoved = run.worldUploadRevision !== run.gate.revisions.scene;
  // What leaves toward the cut kernel is brought back to the eye (`../../../camera/renderOrigin.ts`):
  // a camera that moves therefore changes these sixteen numbers just as much as a moved node. Both
  // causes lead to the same resend, but they do not invalidate the same thing — a surface moved
  // in one case, in the other the same point is rewritten in a closer frame, and nothing the
  // records, the occluders or the cut in hand describe has changed.
  const originMoved = !sameRenderOrigin(run.worldUploadOrigin, cam.eye);
  const rebased = worldsMoved || originMoved;
  rt.timing.worldCounts.racinesRebasees = rebased ? selectionRoots.length : 0;
  let posted: boolean | undefined;
  if (rebased) {
    const scene = run.gate.revisions.scene;
    run.worldUploadRevision = scene;
    run.worldUploadOrigin.set(cam.eye);
    const translationsOnly = !worldsMoved && fullyRebased.get(worldUpdates) === scene;
    // The subtraction is done in double, the single-precision rounding comes after it.
    if (translationsOnly) rootTranslationsToRenderOrigin(worldUpdates, selectionRoots, cam.eye);
    else rootWorldsToRenderOrigin(worldUpdates, selectionRoots, cam.eye);
    posted = run.gpuSelection?.updateWorlds(worldUpdates, worldsMoved, translationsOnly);
    // A send the cut refused — or threw on — leaves it holding older worlds: sent whole next time.
    if (posted === false) fullyRebased.delete(worldUpdates);
    else if (!translationsOnly) fullyRebased.set(worldUpdates, scene);
  }
  // A host write names no root: every row's world matrix, the only shared input to a row the
  // scene can still change after `prepare()`, is written again. The GPU cut compares the worlds it
  // holds: one that found them all unchanged — the host wrote a light, not a pose — keeps the table.
  if (hostWalked && worldsMoved && posted !== false) {
    rows.tableEpoch++;
    invalidateOccluderHistory(run);
  }
  return worldsMoved;
}
