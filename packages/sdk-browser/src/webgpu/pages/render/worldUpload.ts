import { sameRenderOrigin } from '../../../camera/renderOrigin.ts';
import { rootWorldsToRenderOrigin } from '../../../gpu/dag/pack.ts';
import { invalidateOccluderHistory } from '../io/drops.ts';
import type { EngineCamera } from '../../../camera/world.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

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
    run.worldUploadRevision = run.gate.revisions.scene;
    run.worldUploadOrigin.set(cam.eye);
    // The subtraction is done in double, the single-precision rounding comes after it.
    rootWorldsToRenderOrigin(worldUpdates, selectionRoots, cam.eye);
    posted = run.gpuSelection?.updateWorlds(worldUpdates, worldsMoved);
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
