import { markRootRows } from '../frame/render/movedRoot.ts'
import { worldStretch } from '../geometry/selection/rootWorld.ts'
import { noteDeformed } from '../frame/render/movedGeometry.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { holdReach } from './halfFloat.ts'
import { updateWavePages } from './wavePages.ts'

/**
 * Brings the session's GPU deformation to this image, once its poses are uploaded: each
 * deformed root's record rewritten — this frame's palette, weights and wave phases beside the last
 * frame's — and the block sent to the float pool when one moved; each root's reach set for the CPU
 * cut (`ClusterRoot.reach`) and in its mark for the GPU cut; each moving root declared to the
 * shadow scheduler with its rest box grown by what it reached; each page the waves alone carry
 * bounded where they carry it (`wavePages.ts`). A root whose reach spans less than
 * the image's pixel error is drawn at rest, as a coarser cluster would be. Returns whether a
 * record moved.
 */
export function updateWebgpuDeformation(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  const deformation = rt.vis.deformation,
    device = rt.gpu.device,
    pool = rt.vis.concatPos
  if (!deformation?.any || !device || !pool) return false
  const roots = rt.layout.selectionRoots,
    frame = deformation.frame
  const moved = deformation.update(cam, rt.setup.viewport, rt.run.gate.pixelError, rt.run.frame)
  for (let i = 0; i < roots.length; i++) {
    const entry = deformation.entryOf(i)
    if (!frame.bases[entry]) continue
    const root = roots[i],
      before = root.reach ?? 0,
      reach = frame.reach[entry]
    const grew = holdReach(rt, i, reach)
    // Another reach grows its rows' boxes: their inputs are written again, no pose moved.
    if (grew) markRootRows(rt, root, 0, root.pages.length - 1)
    if (frame.dirty[entry] || grew)
      noteDeformed(rt, i, Math.max(before, reach) * worldStretch(root))
  }
  updateWavePages(rt, deformation)
  if (moved) device.queue.writeBuffer(pool, deformation.base * 4, frame.block)
  return moved
}
