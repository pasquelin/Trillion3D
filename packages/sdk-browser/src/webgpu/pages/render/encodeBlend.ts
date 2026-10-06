import { drawBlendPass } from '../../blend/draw.ts'
import { writeBlendView } from '../../blend/uniforms.ts'
import { encodeBlendExpansion } from '../../blend/resources.ts'
import { selectWebgpuBlend } from '../../blend/selection.ts'
import { orderBlendPasses, orderVisibleBlend } from '../../blend/order.ts'
import {
  DRAW_WORDS,
  drawFallbackBlendPass,
  listFallbackBlendDraws,
  writeFallbackBlendUniforms,
} from '../../blend/fallback.ts'
import { encodeTransparentInstances } from '../../transparent/draw.ts'
import { boundWaterPass, encodeWaterPass } from '../../water/pass.ts'
import { encodeParticles } from '../../particles/webgpuParticleFrame.ts'
import { blendLightResources } from '../../blend/lighting.ts'
import { directLightResources } from '../prepare/lightResources.ts'
import { voidStaleBlendGroups } from '../../blend/identity.ts'
import { viewProj } from '../helpers.ts'
import { ensureUniform } from '../prepare/pipelineFor.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** World-space eye of the image, the view uniform's: with no camera the lists keep their order. */
const blendEye = (rt: WebgpuPagesRuntime) => (rt.run.lastCamera ? rt.run.gate.cam.eye : undefined)

/**
 * The transparents of an image, selected, ordered and expanded ahead of anything that draws them:
 * `undefined` without the pass's resources, else whether the blend runs draw them (`true`) or the
 * fallback pass does. The compaction reads the mask this very frame's cluster cut
 * wrote, a few commands earlier in the same buffer, and writes the instance list the runs draw from.
 */
export function prepareBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  composes: boolean,
): boolean | undefined {
  const { gpu, vis, run, timing, blendState } = rt
  if (
    !gpu.pipelineBlend ||
    !blendState.blendGpu.length ||
    // The target the pass draws into (`drawBlendPass`): the visibility path's lighting, the
    // fallback's colour.
    !(vis.visEnabled ? gpu.hdrView : gpu.colorView) ||
    !gpu.depthView ||
    !gpu.uniformBuffer
  )
    return undefined
  const textured = !!(
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
  if (!textured && !gpu.bindGroupLayout) return undefined
  const cpuStart = performance.now()
  encodeTransparentInstances(rt, encoder)
  if (textured) {
    // The frustum verdict — one bit per item to the GPU, THE image's reject count, water's bounds
    // — and the few own entries' order on the CPU; the GPU sorts the rest far to near (a blend
    // writes no depth).
    boundWaterPass(rt, composes, viewProj)
    run.blendFrustumRejected = orderBlendPasses(blendState, blendEye(rt))
    // The GPU orders and expands the plan (instances, one indirect argument per slot), else the CPU.
    encodeBlendExpansion(rt, device, encoder)
  }
  const elapsed = performance.now() - cpuStart
  timing.transparentPrepareMs += elapsed
  timing.transparentEncodeMs += elapsed
  return textured
}

/** Draws the transparents of an image, as `prepareBlend` prepared them (`textured`). */
export function encodeBlend(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  uniformBase: number,
  composes: boolean,
  textured: boolean | undefined,
) {
  const { run, timing, blendState, diag } = rt
  // Every image path reaches this stage: the particles step here, beside the water.
  encodeParticles(rt, device, encoder)
  if (textured === undefined) return
  const cpuStart = performance.now()
  if (!textured) {
    // The untextured pass draws into the display colour: one the visibility path apart does not
    // make wrote nothing shown (`ownsDisplayColor`).
    if (!rt.gpu.colorView) return
    run.blendFrustumRejected = selectWebgpuBlend(
      blendState,
      run.gpuFrameActive
        ? undefined
        : {
            drawn: run.drawn,
            packed: run.drawnPacked,
            roots: rt.layout.selectionRoots,
            rootOfPacked: rt.layout.placement.rootOfPacked,
          },
    )
    orderVisibleBlend(blendState, blendEye(rt))
    const draws = listFallbackBlendDraws(blendState, run.gpuFrameActive)
    ensureUniform(rt, device, uniformBase + draws.length / DRAW_WORDS)
    writeFallbackBlendUniforms(rt, device, uniformBase, draws)
    const ready = performance.now()
    timing.transparentPrepareMs += ready - cpuStart
    drawFallbackBlendPass(rt, device, encoder, uniformBase, draws)
    timing.transparentDrawMs += performance.now() - ready
    timing.transparentEncodeMs += performance.now() - cpuStart
    return
  }
  writeBlendView(rt, device)
  // Resolve lighting resources once; a real resource voids a placeholder's bind group. Their key
  // picks the blend and water programs (`createForwardVariants`).
  const contract = directLightResources(rt)
  voidStaleBlendGroups(rt, blendLightResources(rt, contract))
  const prepared = performance.now()
  timing.transparentPrepareMs += prepared - cpuStart
  drawBlendPass(rt, device, encoder, false, contract)
  // Water after blends, on a frozen backdrop: no transmissive surface reads a half-composed image.
  // Without the pass — a diagnostic view or variant, a second-camera capture, an image no
  // composition follows — the slice draws as one more blend.
  if (blendState.transmissive && !encodeWaterPass(rt, encoder, composes, contract))
    drawBlendPass(rt, device, encoder, true, contract)
  const finished = performance.now()
  timing.transparentDrawMs += finished - prepared
  timing.transparentEncodeMs += finished - cpuStart
  if (diag.traceEnabled)
    diag.traceDiagnostic(
      'transparent-encoding',
      'Transparent surfaces selected and encoded',
      () => ({
        frame: run.frame,
        submission: run.imageRevision,
        candidates: blendState.blendGpu.length,
        visibleMeshes: blendState.visibleBlend.length,
        frustumRejected: run.blendFrustumRejected,
        drawCalls: run.blendDrawCalls,
        submittedTriangles: run.blendSubmittedTriangles,
        transmissiveMeshes: blendState.transmissive,
        encodeMs: timing.transparentEncodeMs,
        passes: blendState.seeds[1].length ? 2 : 1,
      }),
    )
}
