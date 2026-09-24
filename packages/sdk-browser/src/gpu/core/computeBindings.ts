/** `GPUShaderStage.COMPUTE`, written in the clear: the bind entries are also read from Node, without that global. */
export const COMPUTE = 4;

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
  }));
