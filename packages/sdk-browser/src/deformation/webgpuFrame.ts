import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts';
import { updateWholeDeformationBounds } from './wholeBounds.ts';
import { worldStretch } from '../page/cut/logic.ts';
import { noteDeformed } from '../webgpu/pages/render/movedBatch.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { fromHalf, toHalf } from '../../../sdk-core/src/lighting/ltcTable.ts';

/** A half float's value from its sixteen bits, positive ones: what `unpack2x16float` reads. */
export const halfValue = (bits: number) => (bits >= 0x7c00 ? Infinity : fromHalf(bits));

/** The smallest half float at or above `x`, as its sixteen bits: a reach the GPU cut reads never
 *  below the one the CPU cut grows by; past the largest finite half, infinity. */
export function halfAtLeast(x: number) {
  if (!(x > 0)) return 0;
  if (x > 65504) return 0x7c00;
  // The nearest half is one of the two around `x`: the one below steps up to the one above.
  let bits = toHalf(x);
  while (halfValue(bits) < x) bits++;
  return bits;
}

/** `mark` with `reach` in its high sixteen bits, as the GPU cut reads it (`reachOf`, #357). */
export const markReach = (mark: number, reach: number) =>
  ((mark & 0xffff) | (halfAtLeast(reach) << 16)) >>> 0;

/**
 * Brings the session's GPU deformation to this image (#357), once its poses are uploaded: each
 * deformed root's record rewritten — this frame's palette, weights and wave phases beside the last
 * frame's — and the block sent to the float pool when one moved; each root's reach set for the CPU
 * cut (`ClusterRoot.reach`) and in its mark for the GPU cut; each moving root declared to the
 * shadow scheduler with its rest box grown by what it reached; each whole copy's box follows its
 * record and its node (`worldsMoved`). A root whose reach spans less than
 * the image's pixel error is drawn at rest, as a coarser cluster would be. Returns whether a
 * record moved.
 */
export function updateWebgpuDeformation(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  worldsMoved = false,
) {
  const deformation = rt.vis.deformation,
    device = rt.gpu.device,
    pool = rt.vis.concatPos;
  if (!deformation?.any || !device || !pool) return false;
  const roots = rt.layout.selectionRoots,
    frame = deformation.frame;
  const moved = deformation.update(cam, rt.setup.viewport, rt.run.gate.pixelError);
  for (let i = 0; i < roots.length; i++) {
    if (!frame.bases[i]) continue;
    const root = roots[i],
      before = root.reach ?? 0;
    root.reach = frame.reach[i];
    const grew = before !== root.reach;
    rt.run.gpuSelection?.markWorld(i, markReach(root.mark ?? 0, root.reach));
    if (grew) moveRootRows(rt, root);
    if (frame.dirty[i] || grew)
      noteDeformed(rt, i, Math.max(before, root.reach) * worldStretch(root));
  }
  updateWholeDeformationBounds(rt, deformation, worldsMoved);
  if (moved) device.queue.writeBuffer(pool, deformation.base * 4, frame.block);
  return moved;
}
