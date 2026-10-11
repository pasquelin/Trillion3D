/** `GPUShaderStage.COMPUTE`, written in the clear: the bind entries are also read from Node, without that global. */
export const COMPUTE = 4

/** A buffer binding of `type` at `binding` in a layout, seen by `visibility` (the compute stage by
 *  default): the one writing of the entry every layout of a kernel repeats. */
export const computeBufferEntry = (
  binding: number,
  type: GPUBufferBindingType,
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry => ({ binding, visibility, buffer: { type } })

/** A uniform buffer binding at `binding` in a layout, seen by `visibility` (the compute stage by
 *  default): read at a dynamic offset when `hasDynamicOffset`, `minBindingSize` bytes at least. */
export const computeUniformEntry = (
  binding: number,
  {
    hasDynamicOffset,
    minBindingSize,
  }: { hasDynamicOffset?: boolean; minBindingSize?: number } = {},
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry => ({
  binding,
  visibility,
  buffer: {
    type: 'uniform',
    ...(hasDynamicOffset === undefined ? {} : { hasDynamicOffset }),
    ...(minBindingSize === undefined ? {} : { minBindingSize }),
  },
})

/** A sampled texture binding of `sampleType` and `viewDimension` at `binding` in a layout, seen by
 *  `visibility` (the compute stage by default). */
export const computeTextureEntry = (
  binding: number,
  sampleType: GPUTextureSampleType,
  viewDimension: GPUTextureViewDimension = '2d',
  visibility = COMPUTE,
): GPUBindGroupLayoutEntry => ({ binding, visibility, texture: { sampleType, viewDimension } })

/**
 * Bind-group entries of a kernel whose group-0 buffers are named by `bindings` (name → binding):
 * each buffer lands at the binding of its shader name, whatever order the caller lists them in.
 */
export const namedBufferEntries = <Name extends string>(
  bindings: Record<Name, number>,
  buffers: Record<Name, GPUBufferBinding>,
): GPUBindGroupEntry[] =>
  (Object.keys(bindings) as Name[]).map((name) => ({
    binding: bindings[name],
    resource: buffers[name],
  }))
