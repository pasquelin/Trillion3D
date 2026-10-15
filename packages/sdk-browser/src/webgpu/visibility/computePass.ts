import { bufferLayout, textureLayout } from '../../gpu/core/computeBindings.ts'
/** A binding of a compute pass: a buffer of that type, or a texture of that sample type. */
export type ComputeBinding =
  GPUBufferBindingType | { texture: GPUTextureSampleType; dimension?: GPUTextureViewDimension }
/** The layout of a binding of that type, past its number and stage (`computeBindings.ts`). */
export const bindingLayout = (type: ComputeBinding) =>
  typeof type === 'string' ? bufferLayout(type) : textureLayout(type.texture, type.dimension)
/** The bind-group resource of a binding of that type: the buffer, or the texture's view. */
export const bindingResource = (type: ComputeBinding, resource: GPUBuffer | GPUTextureView) =>
  typeof type === 'string' ? { buffer: resource as GPUBuffer } : (resource as GPUTextureView)
