/** The strict minimum of a device for the temporal pass: every creation answers an inert object. */
export function inertTaaDevice() {
  Object.assign(globalThis, {
    GPUBufferUsage: { UNIFORM: 64, COPY_DST: 8, STORAGE: 128 },
    GPUShaderStage: { FRAGMENT: 2 },
    GPUTextureUsage: { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 },
  });
  const inert = () => ({ destroy() {}, createView: () => ({}) }) as never;
  return {
    createBuffer: inert,
    createTexture: inert,
    createBindGroupLayout: inert,
    createPipelineLayout: inert,
    createSampler: inert,
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createRenderPipelineAsync: async () => ({}),
    queue: { writeBuffer() {} },
  } as unknown as GPUDevice;
}
