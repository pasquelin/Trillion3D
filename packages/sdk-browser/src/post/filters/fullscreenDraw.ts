import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'

/**
 * A fullscreen draw over one colour target, as the post chain's passes make it: the one
 * descriptor every pass begins with, rewritten in place — a pass reads it when it begins, so a
 * frame allocates none —, the target cleared, the triangle drawn with `groups` bound at 0 and 1,
 * over the whole target or, with `corner`, over its first `corner[0] × corner[1]` pixels.
 * `label` names the passes in the profile (`../../diagnostic/stage/passLabels.ts`).
 */
export function fullscreenDraw(label: string) {
  const attachment = { loadOp: 'clear', storeOp: 'store' } as GPURenderPassColorAttachment
  const descriptor: GPURenderPassDescriptor = { label, colorAttachments: [attachment] }
  const groups: GPUBindGroup[] = []
  return (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline | undefined,
    group: GPUBindGroup,
    second?: GPUBindGroup,
    corner?: readonly number[],
  ) => {
    attachment.view = view
    groups.length = 0
    groups.push(group)
    if (second) groups.push(second)
    drawFullscreenTriangle(encoder, descriptor, pipeline, groups, corner?.[0], corner?.[1])
  }
}
