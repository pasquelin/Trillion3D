/** The creators a fake device needs to build layouts and pipelines: each keeps only its
 *  descriptor, or nothing. Bind groups are left to the caller, which records them or not. */
export function layoutCreators() {
  return {
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({ size, usage }),
    createBindGroupLayout: (desc: unknown) => desc,
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
  };
}
