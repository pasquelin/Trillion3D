import { requestFrameTargets } from '../prepare/targetGrant.ts'
import { viewProj } from '../backend/helpers.ts'
import { taaRenderMatrix } from '../../post/taa/frame.ts'
import { abandonFrameEncoder } from './encoder.ts'
import { encodeVis } from './encodeVis.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/** Encodes and submits one image of the drawn cut. */
export function encodeDraws(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { gpu, vis, run, timing, blendState, diag } = rt
  run.gpuDrawCalls = 0
  run.gpuComputeDispatches = 0
  run.blendDrawCalls = 0
  run.blendFrustumRejected = 0
  timing.transparentPrepareMs = 0
  timing.transparentDrawMs = 0
  timing.transparentSpanUploadBytes = 0
  if (!gpu.cache || !gpu.depthView) return
  // Frustum planes and view-projection are those image entry posted: the engine has one depth
  // convention (`../../camera/depthConvention.ts`), so nothing is converted along the path.
  blendState.blendPlanes.set(cam.planes)
  // The render matrix carries temporal-antialiasing jitter; the camera knows nothing of it.
  viewProj.set(taaRenderMatrix(rt, cam))
  if (run.clustersSyncedFrame !== run.frame) {
    rt.services.syncClusters()
    run.clustersSyncedFrame = run.frame
  }
  // The engine draws through the visibility pass alone (#1483): pipelines a prepare left missing
  // are its failure, never another image.
  if (!vis.visPipelineBack || !vis.shadeClasses)
    throw new Error('WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE')
  // Targets not made yet — refused, or late after a resize — draw nothing: the last image stays
  // shown, and they are asked for. Past this, the image's encoders read them as made.
  if (!vis.visView || !gpu.surfaces || !gpu.hdrView || !gpu.displayView) {
    abandonFrameEncoder(rt)
    void requestFrameTargets(rt, device)
    return
  }
  try {
    encodeVis(rt, device, cam)
  } catch (error) {
    abandonFrameEncoder(rt)
    timing.gpuTiming?.cancelUnsubmitted()
    diag.diagnosticFailure('visibility-render-failed', error)
    run.gpuDrawCalls = 0
    throw error
  }
}
