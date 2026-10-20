import { enginePose } from '../camera/world.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { debugMode } from '../host/debugMode.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { transparentCounts } from '../webgpu/pages/state/transparentCounts.ts'

// The frame's cost snapshot, a debug-mode tool (`debugMode`: a world's `debug`, `?profile`): the
// CPU profile carries it on the diagnostic channel (`cpuSteps.ts`), no console of its own.

/** The view as the audit publishes it: the engine camera’s world pose, and its field. */
const viewPose = (cam: EngineCamera) => ({
  ...enginePose(cam),
  fov: cam.fov,
  near: cam.near,
  far: cam.far,
})

/** The frame's costs once per snapshot. The transparents the frustum left out are the GPU
 * verdict's count, read back a few images late (`verdictRead.ts`): no CPU walk repeats it, and no
 * selection changes. */
export function gpuFrameCostSnapshot(rt: WebgpuPagesRuntime) {
  if (!debugMode()) return undefined
  const { blendState, run, timing } = rt,
    blend = transparentCounts(rt)
  return {
    selection: 'gpu',
    // The published pose is the engine camera’s, which frame entry has just copied:
    // no host camera is reread here, and nothing is read until a frame has been rendered.
    camera: run.lastCamera && viewPose(run.gate.cam),
    resolution: [...rt.gpu.targetSize],
    pixelError: run.diagnosticPixelError,
    transparentCandidates: blend.candidates,
    transparentListed: blend.visibleMeshes,
    transparentEncodedDraws: blend.drawCalls,
    transparentPrepareMs: timing.transparentPrepareMs,
    transparentDrawMs: timing.transparentDrawMs,
    transparentSpanUploadBytes: timing.transparentSpanUploadBytes,
    listedOutsideFrustum: blend.frustumRejected,
    gpuEmptyDraws: null,
    pagedItems: blendState.table?.pagedItems.length ?? 0,
    compactionEntriesWithPadding: blendState.table?.length ?? 0,
    gpuCompactionAvailable: !!blendState.compaction?.encode,
    gpuTiming: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuTimingIsAsynchronous: true,
  }
}
