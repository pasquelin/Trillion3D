import type { WebgpuPagesRuntime } from '../runtime.ts'

/** The transparent pass's counts of the frame: the surfaces it weighed, those in view, the ones the
 *  frustum turned away, the draws and the triangles it sent. The one record the trace of the pass
 *  and the frame's metrics both read. */
export const transparentCounts = ({
  blendState,
  run,
}: Pick<WebgpuPagesRuntime, 'blendState' | 'run'>) => ({
  candidates: blendState.blendGpu.length,
  visibleMeshes: blendState.visibleBlend.length,
  frustumRejected: run.blendFrustumRejected,
  drawCalls: run.blendDrawCalls,
  submittedTriangles: run.blendSubmittedTriangles,
})
