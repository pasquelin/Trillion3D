import { pixelScaleOf } from '../streaming/priority.ts';
import { worldStretch } from '../page/cut/logic.ts';
import { noteDeformed } from '../webgpu/pages/render/movedBatch.ts';
import type { EngineCamera } from '../camera/world.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/** A half float's value from its sixteen bits, positive ones: what `unpack2x16float` reads. */
export const halfValue = (bits: number) =>
  bits >= 0x7c00
    ? Infinity
    : bits < 0x0400
      ? bits * 2 ** -24
      : (1 + (bits & 1023) / 1024) * 2 ** ((bits >> 10) - 15);

/** The smallest half float at or above `x`, as its sixteen bits: a reach the GPU cut reads never
 *  below the one the CPU cut grows by; past the largest finite half, infinity. */
export function halfAtLeast(x: number) {
  if (!(x > 0)) return 0;
  if (x > 65504) return 0x7c00;
  let e = Math.floor(Math.log2(x));
  if (2 ** e > x) e--;
  if (2 ** (e + 1) <= x) e++;
  let bits =
    e < -14 ? Math.ceil(x / 2 ** -24) : ((e + 15) << 10) + Math.ceil((x / 2 ** e - 1) * 1024);
  // A carry past the mantissa lands on the next exponent's first value, which the bits spell.
  while (halfValue(bits) < x) bits++;
  return bits;
}

/** `mark` with `reach` in its high sixteen bits, as the GPU cut reads it (`reachOf`, #357). */
export const markReach = (mark: number, reach: number) =>
  ((mark & 0xffff) | (halfAtLeast(reach) << 16)) >>> 0;

const scale: [number, number] = [1, 1];

/** How many pixels `reach` of root's units spans at worst, seen from `cam`: from the nearest point
 *  of its rest box the reach can bring closer. */
function pixelsOf(root: ClusterRoot<PageRec>, reach: number, cam: EngineCamera, focal: number) {
  const box = root.worldBox;
  if (!box) return Infinity;
  const world = reach * worldStretch(root);
  let squared = 0;
  for (let c = 0; c < 3; c++) {
    const gap = Math.max(0, box[c] - cam.eye[c], cam.eye[c] - box[c + 3]);
    squared += gap * gap;
  }
  const distance = Math.sqrt(squared) - world;
  return distance > cam.near ? (world * focal) / distance : Infinity;
}

/**
 * Brings the session's GPU deformation to this image (#357), once its poses are uploaded: each
 * deformed root's record rewritten — this frame's palette, weights and wave phases beside the last
 * frame's — and the block sent to the float pool when one moved; each root's reach set for the CPU
 * cut (`ClusterRoot.reach`) and in its mark for the GPU cut; each moving root declared to the
 * shadow scheduler with its rest box grown by what it reached. A root whose reach spans less than
 * the image's pixel error is drawn at rest, as a coarser cluster would be. Returns whether a
 * record moved.
 */
export function updateWebgpuDeformation(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const deformation = rt.vis.deformation,
    device = rt.gpu.device,
    pool = rt.vis.concatPos;
  if (!deformation?.any || !device || !pool) return false;
  const roots = rt.layout.selectionRoots,
    frame = deformation.frame,
    threshold = rt.run.gate.pixelError;
  pixelScaleOf(cam.projection, rt.setup.viewport, scale);
  const focal = Math.max(scale[0], scale[1]);
  const moved = frame.update(
    (i, reach) => threshold > 0 && pixelsOf(roots[i], reach, cam, focal) < threshold,
  );
  for (let i = 0; i < frame.bases.length; i++) {
    if (!frame.bases[i]) continue;
    const root = roots[i],
      before = root.reach ?? 0;
    root.reach = frame.reach[i];
    rt.run.gpuSelection?.markWorld(i, markReach(root.mark ?? 0, root.reach));
    if (frame.moving[i]) noteDeformed(rt, i, Math.max(before, root.reach) * worldStretch(root));
  }
  if (moved) device.queue.writeBuffer(pool, deformation.base * 4, frame.block);
  return moved;
}
