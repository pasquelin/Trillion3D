import { moveRootRows } from '../webgpu/pages/render/movedRoot.ts'
import { updateWholeDeformationBounds } from './wholeBounds.ts'
import { worldStretch } from '../page/cut/logic.ts'
import { noteDeformed } from '../webgpu/pages/render/movedGeometry.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { markReach } from './halfFloat.ts'
import { updateWavePages } from './wavePages.ts'

/**
 * Brings the session's GPU deformation to this image, once its poses are uploaded: each
 * deformed root's record rewritten — this frame's palette, weights and wave phases beside the last
 * frame's — and the block sent to the float pool when one moved; each root's reach set for the CPU
 * cut (`ClusterRoot.reach`) and in its mark for the GPU cut; each moving root declared to the
 * shadow scheduler with its rest box grown by what it reached; each page the waves alone carry
 * bounded where they carry it (`wavePages.ts`); each whole copy's box follows its
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
    pool = rt.vis.concatPos
  if (!deformation?.any || !device || !pool) return false
  const roots = rt.layout.selectionRoots,
    frame = deformation.frame
  const moved = deformation.update(cam, rt.setup.viewport, rt.run.gate.pixelError, rt.run.frame)
  for (let i = 0; i < roots.length; i++) {
    if (!frame.bases[i]) continue
    const root = roots[i],
      before = root.reach ?? 0
    root.reach = frame.reach[i]
    const grew = before !== root.reach
    rt.run.gpuSelection?.markWorld(i, markReach(root.mark ?? 0, root.reach))
    if (grew) moveRootRows(rt, root)
    if (frame.dirty[i] || grew)
      noteDeformed(rt, i, Math.max(before, root.reach) * worldStretch(root))
  }
  updateWavePages(rt, frame)
  updateWholeDeformationBounds(rt, deformation, worldsMoved)
  if (moved) device.queue.writeBuffer(pool, deformation.base * 4, frame.block)
  return moved
}
