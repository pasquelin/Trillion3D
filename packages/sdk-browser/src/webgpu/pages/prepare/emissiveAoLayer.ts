import { withEmissiveAo } from '../../../scene/surfaceAllocation.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** A diagnostic GPU variant, or the feedback A/B's session: their stages have no twin without an
 *  output, so the pipelines keep every one (`wantsEmissiveAo`, `wantsFeedback`). */
export const keepsEveryOutput = ({ context }: Pick<WebgpuPagesRuntime, 'context'>) =>
  !!context.diagnosticGpuVariant || context.feedbackTargetAB === true

/**
 * Whether an image needs the emission-and-occlusion layer, as its preparation sees it: one of its
 * opaque surfaces can emit or occlude (`ShadeCensus.emits`); a water surface draws, whose
 * composite reads the layer without the mark; impostor cards may draw, whose occlusion is their
 * atlas's; or a diagnostic variant or the feedback A/B runs, whose stages have no twin without it.
 * A surface that comes to emit later is heard by the census at the next frame entry, which holds
 * the image until the classes that write the layer are compiled (`../../frame/framePipelines.ts`).
 */
export function wantsEmissiveAo(rt: WebgpuPagesRuntime) {
  const { blendState, gpu, vis } = rt
  if (keepsEveryOutput(rt)) return true
  if (blendState.transmissive > 0 || gpu.impostorCode) return true
  return !!vis.shadeCensus?.emits
}

/**
 * Before an image's resolve: the classes in place write the layer once a surface came to emit or
 * occlude — switched at the frame entry the census heard it, compiled (`../../frame/framePipelines.ts`);
 * a row that shows one no announced change brought (`emissiveAoShown`) switches them here, each
 * compiled at its first draw. The drawn view's surfaces then get the layer in place of its stand-in,
 * the other targets kept. The image that first draws the surface writes its emission: none is drawn
 * without it.
 */
export function followEmissiveAo(rt: WebgpuPagesRuntime) {
  const { vis, gpu } = rt
  if (vis.emissiveAoShown && !vis.writesEmissiveAo && vis.shadeClasses) {
    vis.shadeClasses = vis.shadeClasses.withEmissiveAo()
    vis.writesEmissiveAo = true
  }
  const surfaces = gpu.surfaces
  if (!vis.writesEmissiveAo || !surfaces || surfaces.hasEmissiveAo || !gpu.device) return
  gpu.surfaces = withEmissiveAo(gpu.device, surfaces)
  gpu.targetBytes += gpu.surfaces.allocationBytes - surfaces.allocationBytes
}
