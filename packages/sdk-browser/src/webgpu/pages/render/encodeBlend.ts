import { cpuNow, msSince } from '../../../diagnostic/stopwatch.ts'
import { drawBlendPass } from '../../blend/draw.ts'
import { writeBlendView } from '../../blend/uniforms.ts'
import { encodeBlendExpansion } from '../../blend/expansionFrame.ts'
import { orderBlendPasses } from '../../blend/order.ts'
import { encodeTransparentInstances } from '../../transparent/draw.ts'
import { boundWaterPass, encodeWaterPass } from '../../water/pass.ts'
import { encodeParticles } from '../../particles/webgpuParticleFrame.ts'
import { blendLightResources } from '../../blend/lighting.ts'
import { directLightResources } from '../prepare/contractLight.ts'
import { voidStaleBlendGroups } from '../../blend/identity.ts'
import { viewProj } from '../helpers.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { transparentCounts } from '../state/transparentCounts.ts'

/** World-space eye of the image, the view uniform's: with no camera the lists keep their order. */
const blendEye = (rt: WebgpuPagesRuntime) => (rt.run.lastCamera ? rt.run.gate.cam.eye : undefined)

/**
 * The transparents of an image, selected, ordered and expanded ahead of anything that draws them:
 * `false` without the pass's resources. The compaction reads the mask this very frame's cluster cut
 * wrote, a few commands earlier in the same buffer, and writes the instance list the runs draw from.
 */
export function prepareBlend(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  composes: boolean,
): boolean {
  const { gpu, vis, run, timing, blendState } = rt
  const ready = !!(
    blendState.blendGpu.length &&
    // The target the pass draws into (`drawBlendPass`).
    gpu.hdrView &&
    gpu.depthView &&
    vis.blendBindGroupLayout &&
    vis.blendPipelines &&
    vis.textures &&
    vis.mapsSampler &&
    vis.concatPos &&
    vis.concatUv &&
    vis.concatNrm &&
    gpu.zeroUv &&
    blendState.itemBuffer &&
    blendState.viewBuffer &&
    blendState.argsBuffer &&
    blendState.expandedBuffer
  )
  if (!ready) return false
  const cpuStart = cpuNow()
  encodeTransparentInstances(rt, encoder)
  // The few own entries' order on the CPU, the frame's head for the GPU — the eye, the frustum
  // planes, the water's view —; the GPU judges every item, bounds the water and sorts the rest far
  // to near (a blend writes no depth).
  boundWaterPass(rt, composes, viewProj)
  orderBlendPasses(blendState, blendEye(rt))
  // The GPU judges, orders and expands the plan: instances, one indirect argument per slot.
  encodeBlendExpansion(rt, encoder)
  // The image's reject count is the GPU's, read back a few images late (`verdictRead.ts`).
  run.blendFrustumRejected = blendState.expand?.counts.rejected ?? 0
  const elapsed = msSince(cpuStart)
  timing.transparentPrepareMs += elapsed
  timing.transparentEncodeMs += elapsed
  return true
}

/** Draws the transparents of an image, as `prepareBlend` prepared them (`ready`). */
export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  composes: boolean,
  ready: boolean,
) {
  const { run, timing, blendState, diag } = rt
  // Every image reaches this stage: the particles step here, beside the water.
  encodeParticles(rt, device, encoder)
  if (!ready) return
  const cpuStart = cpuNow()
  writeBlendView(rt, device)
  // Resolve lighting resources once; a real resource voids a placeholder's bind group. Their key
  // picks the blend and water programs (`createForwardVariants`).
  const contract = directLightResources(rt)
  // The material records the item records named go up before a group names their texture.
  if (rt.vis.materialTable.pending) rt.vis.materialTable.upload(device)
  voidStaleBlendGroups(rt, blendLightResources(rt, contract))
  const prepared = cpuNow()
  timing.transparentPrepareMs += prepared - cpuStart
  drawBlendPass(rt, device, encoder, false, contract)
  // Water after blends, on a frozen backdrop: no transmissive surface reads a half-composed image.
  // Without the pass — a diagnostic view or variant, a second-camera capture, an image no
  // composition follows — the slice draws as one more blend.
  if (blendState.transmissive && !encodeWaterPass(rt, encoder, composes, contract))
    drawBlendPass(rt, device, encoder, true, contract)
  const finished = cpuNow()
  timing.transparentDrawMs += finished - prepared
  timing.transparentEncodeMs += finished - cpuStart
  if (diag.traceEnabled)
    diag.traceDiagnostic(
      'transparent-encoding',
      'Transparent surfaces selected and encoded',
      () => ({
        frame: run.frame,
        submission: run.imageRevision,
        ...transparentCounts(rt),
        transmissiveMeshes: blendState.transmissive,
        encodeMs: timing.transparentEncodeMs,
        passes: blendState.seeds[1].length ? 2 : 1,
      }),
    )
}
