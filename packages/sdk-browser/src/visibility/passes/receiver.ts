import { SURFACE_WORDS_FORMAT } from '../../materials/surface/surfaceOutputs.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createFloatAtlas } from '../../gpu/core/floatAtlas.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The receiver binding of a layout at \`binding\`: the resolve's receiver, the two layers of the
 *  surfaces' words that hold it (\`receiverTargetWgsl.ts\`), read by load. */
export const receiverLayoutEntry = (binding: number, visibility: GPUShaderStageFlags) =>
  computeTextureEntry(binding, 'uint', '2d-array', visibility)

/** The frame's shadow receiver target, the one the resolve wrote (\`shadeBindings.ts\`), or nothing
 *  while it does not exist: then no pixel was resolved, and none is lit. */
export const receiverResources = ({ gpu }: WebgpuPagesRuntime) => gpu.surfaces?.receiverView

/**
 * Stand-ins a lit program binds before the resolve's targets exist: a receiver texel of zero (no
 * receiver, \`shadowReceiverOf\`), and the empty normal atlas a transparent item without normals
 * reads.
 */
export function receiverPlaceholders(device: GPUDevice) {
  const target = standInTexture(device, 'Trillion3D empty receiver', SURFACE_WORDS_FORMAT, {
    layers: 2,
  })
  const normals = createFloatAtlas(device, 'Trillion3D empty normals', 1)
  return {
    resources: target.createView({ dimension: '2d-array' }),
    normals: normals.view,
    dispose() {
      normals.texture.destroy()
      target.destroy()
    },
  }
}
