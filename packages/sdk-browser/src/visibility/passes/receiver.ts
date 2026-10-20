import { RECEIVER_TARGET_FORMAT } from '../shader/receiverTargetWgsl.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createFloatAtlas } from '../../gpu/core/floatAtlas.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The receiver binding of a layout at \`binding\`: the resolve's receiver target
 *  (\`receiverTargetWgsl.ts\`), read by load. */
export const receiverLayoutEntry = (binding: number, visibility: GPUShaderStageFlags) =>
  computeTextureEntry(binding, 'uint', '2d', visibility)

/** The frame's shadow receiver target, the one the resolve wrote (\`shadeBindings.ts\`), or nothing
 *  while it does not exist: then no pixel was resolved, and none is lit. */
export const receiverResources = ({ gpu }: WebgpuPagesRuntime) => gpu.surfaces?.receiverView

/**
 * Stand-ins a lit program binds before the resolve's targets exist: a receiver texel of zero (no
 * receiver, \`shadowReceiverOf\`), and the empty normal atlas a transparent item without normals
 * reads.
 */
export function receiverPlaceholders(device: GPUDevice) {
  const target = standInTexture(device, 'Trillion3D empty receiver', RECEIVER_TARGET_FORMAT)
  const normals = createFloatAtlas(device, 'Trillion3D empty normals', 1)
  return {
    resources: target.createView(),
    normals: normals.view,
    dispose() {
      normals.texture.destroy()
      target.destroy()
    },
  }
}
