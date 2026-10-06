/** A binding of a compute pass: a buffer of that type, or a texture of that sample type. */
export type ComputeBinding =
  GPUBufferBindingType | { texture: GPUTextureSampleType; dimension?: GPUTextureViewDimension }
/** The layout entry of a binding of that type. */
export const bindingLayout = (type: ComputeBinding) =>
  typeof type === 'string'
    ? { buffer: { type } }
    : { texture: { sampleType: type.texture, viewDimension: type.dimension ?? '2d' } }
/** The bind-group resource of a binding of that type: the buffer, or the texture's view. */
export const bindingResource = (type: ComputeBinding, resource: GPUBuffer | GPUTextureView) =>
  typeof type === 'string' ? { buffer: resource as GPUBuffer } : (resource as GPUTextureView)
