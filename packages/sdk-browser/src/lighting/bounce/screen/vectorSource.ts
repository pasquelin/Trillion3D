import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/**
 * THE ONE PLACE THE SCREEN PROBES TAKE THE SURFACES' VECTORS FROM: the texture of one word a render texel
 * (`decodeVector`) that says where each surface stood in the image before — the one the view's velocity stage
 * wrote this image, before the lighting, where a pass reads it (`gpu.velocity`, `../../../post/taa/velocityFrame.ts`).
 * None where the stage did not measure: the surfaces are then taken as still. No kernel, group or setting of
 * the probes reads a vector anywhere else.
 */
export function screenProbeVectors({ gpu }: WebgpuPagesRuntime): GPUTextureView | undefined {
  const { velocity } = gpu
  return velocity?.active && velocity.measured ? velocity.vectors : undefined
}
