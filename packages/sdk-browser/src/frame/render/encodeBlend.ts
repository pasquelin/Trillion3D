import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { countBlendDraws, drawBlendPass } from '../../blend/draw.ts'
import { writeBlendView } from '../../blend/uniforms.ts'
import { encodeBlendExpansion } from '../../blend/expand/expansionFrame.ts'
import { orderBlendPasses } from '../../blend/order/order.ts'
import { encodeTransparentInstances } from '../../blend/transparent/draw.ts'
import { encodeDistortion } from '../../blend/distortion.ts'
import { encodeParticles } from '../../particles/gpu/webgpuParticleFrame.ts'
import { blendLightResources } from '../../blend/lighting.ts'
import { directLightResources } from '../prepare/contractLight.ts'
import { voidStaleBlendGroups } from '../../blend/identity.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { ContractKey } from '../../lighting/deferred/contractCuts.ts'
import { transparentCounts } from '../backend/state/transparentCounts.ts'

/** World-space eye of the image, the view uniform's: with no camera the lists keep their order. */
const blendEye = (rt: WebgpuPagesRuntime) => (rt.run.lastCamera ? rt.run.gate.cam.eye : undefined)

/**
 * The transparents of an image, selected, ordered and expanded ahead of anything that draws them:
 * `false` without the pass's resources. The compaction reads the mask this very frame's cluster cut
 * wrote, a few commands earlier in the same buffer, and writes the instance list the runs draw from.
 */
export function prepareBlend(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder): boolean {
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
  // planes —; the GPU judges every item and sorts them far to near (a blend writes no depth).
  orderBlendPasses(blendState, blendEye(rt))
  // The GPU judges, orders and expands the plan: instances, one indirect argument per slot.
  encodeBlendExpansion(rt, encoder)
  // The image's reject count is the GPU's, read back a few images late (`verdictRead.ts`).
  run.blendFrustumRejected = blendState.expand?.counts.rejected ?? 0
  const elapsed = msSince(cpuStart)
  timing.transparentPrepareMs += elapsed
  return true
}

/**
 * What the transparents of an image draw with, once `prepareBlend` prepared them, before any pass of
 * theirs — the front pass the reflection trace reads (`encodeFrontPass`) and the blend pass —: the blend
 * view, the material records the item records name, and the groups, a real resource voiding a
 * placeholder's group. Returns the frame's lights' key, which picks the blend programs
 * (`createForwardVariants`).
 */
export function bindBlend(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { timing } = rt
  const cpuStart = cpuNow()
  writeBlendView(rt, device)
  const contract = directLightResources(rt)
  // The material records the item records named go up before a group names their texture.
  rt.vis.materialTable.viewFor(device)
  voidStaleBlendGroups(rt, blendLightResources(rt, contract))
  const elapsed = msSince(cpuStart)
  timing.transparentPrepareMs += elapsed
  return contract
}

/** Draws the transparents of an image, bound by `bindBlend`, lit with the lights' key `contract` it
 *  returned; none where they were not prepared (`contract` absent): the distortion of the
 *  opaque scene first, so refraction bends only what lies behind, then every translucent layer
 *  over it (`encodeDistortion`,
 *  `drawBlendPass`). */
export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  contract: Partial<ContractKey> | undefined,
) {
  const { run, timing, blendState, diag, vis } = rt
  // Every image reaches this stage: the particles step here.
  encodeParticles(rt, device, encoder)
  if (!contract) return
  const prepared = cpuNow()
  countBlendDraws(rt, encodeDistortion(rt, device, encoder, vis.blendPipelines?.transmission))
  drawBlendPass(rt, device, encoder, contract)
  timing.transparentDrawMs += cpuNow() - prepared
  if (diag.traceEnabled)
    diag.traceDiagnostic(
      'transparent-encoding',
      'Transparent surfaces selected and encoded',
      () => ({
        frame: run.frame,
        submission: run.imageRevision,
        ...transparentCounts(rt),
        transmissiveMeshes: blendState.transmissive,
        encodeMs: timing.transparentPrepareMs + timing.transparentDrawMs,
      }),
    )
}
