import { computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** The receiver binding of a layout at \`binding\`: the resolve's receiver, the two layers of the
 *  surfaces' words that hold it (\`receiverTargetWgsl.ts\`), read by load. */
export const receiverLayoutEntry = (binding: number, visibility: GPUShaderStageFlags) =>
  computeTextureEntry(binding, 'uint', '2d-array', visibility)
