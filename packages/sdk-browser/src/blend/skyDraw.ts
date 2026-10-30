import { countBlendDraws, drawBlendRuns } from './draw.ts'
import { feedbackAttachment } from '../frame/prepare/attachments.ts'
import type { RankedPipelines } from './stagePipelines.ts'
import type { WebgpuPagesRuntime } from '../frame/backend/runtime.ts'

/**
 * A render pass of the sky surfaces (`MATERIAL_FLAG.sky`): the pass of `colour` and `depth`, the texture-feedback target beside the colour
 * where the pipelines write it, which opens, sets the viewport to the target, draws the runs of the sky view of the expansion
 * (`expansionViews.ts`) the caller found open (`view`: `skyViewOf`) with the blend modes' own stage `pipelines`, and ends. The pass of the sky
 * (`encodeSkyPass.ts`) and of a face of the sky meshes' capture (`encodeSkyMeshFace.ts`) are two of it, one descriptor each: no layer of the
 * translucency draws a sky surface, and this draws nothing else. Returns the draws encoded and the slots left waiting for a pipeline.
 */
export function skyPass(
  label: string,
  colour: GPURenderPassColorAttachment,
  depth: GPURenderPassDepthStencilAttachment,
) {
  const targets: (GPURenderPassColorAttachment | null)[] = [colour, null]
  const descriptor: GPURenderPassDescriptor = {
    label,
    colorAttachments: targets,
    depthStencilAttachment: depth,
  }
  return (
    rt: WebgpuPagesRuntime,
    device: GPUDevice,
    encoder: GPUCommandEncoder,
    pipelines: RankedPipelines,
    view: number,
  ) => {
    targets[1] = rt.vis.writesFeedback ? feedbackAttachment(rt) : null
    const pass = encoder.beginRenderPass(descriptor)
    pass.setViewport(0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1], 0, 1)
    const waiting = { slots: 0 }
    const encoded = drawBlendRuns(rt, device, pass, pipelines, { view, waiting })
    countBlendDraws(rt, encoded)
    pass.end()
    return { encoded, waiting: waiting.slots }
  }
}
