// The fullscreen passes' one way to a pipeline: the deferred lighting and composition, the
// temporal resolve, the water composite and the blend stages build theirs here.

/** Builds a render pipeline, asynchronously when the device offers it. */
export const buildRenderPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  device.createRenderPipelineAsync
    ? device.createRenderPipelineAsync(descriptor)
    : Promise.resolve(device.createRenderPipeline(descriptor));

/** Builds a compute pipeline, asynchronously when the device offers it. */
export const buildComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) =>
  device.createComputePipelineAsync
    ? device.createComputePipelineAsync(descriptor)
    : Promise.resolve(device.createComputePipeline(descriptor));

/** A render pipeline compiled off the frame by `prepare`, or at once by `get` when nothing
 *  prepared it: a frame never compiles what prepare did. */
export function preparedPipeline(device: GPUDevice, descriptor: GPURenderPipelineDescriptor) {
  let made: GPURenderPipeline | undefined;
  return {
    async prepare() {
      const built = await buildRenderPipeline(device, descriptor);
      made ??= built;
    },
    get: () => (made ??= device.createRenderPipeline(descriptor)),
  };
}

/** A fullscreen-triangle pipeline on one bind group layout or one per group, at the targets given. */
export function makeFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  bind: GPUBindGroupLayout | readonly GPUBindGroupLayout[],
  entryPoint: string,
  targets: GPUColorTargetState[],
) {
  return buildRenderPipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bind].flat() }),
    vertex: { module, entryPoint: 'fullscreen' },
    fragment: { module, entryPoint, targets },
    primitive: { topology: 'triangle-list' },
  });
}
