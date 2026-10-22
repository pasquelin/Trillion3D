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
  return (
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    pipeline: GPURenderPipeline,
    group: GPUBindGroup,
    second?: GPUBindGroup,
    corner?: readonly number[],
  ) => {
    attachment.view = view
    const pass = encoder.beginRenderPass(descriptor)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    if (second) pass.setBindGroup(1, second)
    if (corner) pass.setViewport(0, 0, corner[0], corner[1], 0, 1)
    pass.draw(3)
    pass.end()
  }
}
