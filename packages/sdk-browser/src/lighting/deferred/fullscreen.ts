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

/** The compute stages of one module on one layout, by entry point, compiled together off the thread
 *  (#1362): prepare never builds its pipelines one after another. */
export async function buildComputeStages<E extends string>(
  device: GPUDevice,
  layout: GPUPipelineLayout,
  module: GPUShaderModule,
  entryPoints: readonly E[],
  constants?: Record<string, number>,
) {
  const built = await Promise.all(
    entryPoints.map((entryPoint) =>
      buildComputePipeline(device, {
        layout,
        compute: { module, entryPoint, ...(constants && { constants }) },
      }),
    ),
  );
  return Object.fromEntries(entryPoints.map((entry, at) => [entry, built[at]])) as Record<
    E,
    GPUComputePipeline
  >;
}

/** A pipeline compiled off the frame by `prepare`, or at once by `get` when nothing prepared it: a
 *  frame never compiles what prepare did. */
function prepared<D, P>(descriptor: D, build: (d: D) => Promise<P>, create: (d: D) => P) {
  let made: P | undefined;
  return {
    async prepare() {
      if (made) return;
      const built = await build(descriptor);
      made ??= built;
    },
    get: () => (made ??= create(descriptor)),
  };
}

/** A render pipeline prepared off the frame (`prepared`). */
export const preparedPipeline = (device: GPUDevice, descriptor: GPURenderPipelineDescriptor) =>
  prepared(
    descriptor,
    (d) => buildRenderPipeline(device, d),
    (d) => device.createRenderPipeline(d),
  );

/** A compute pipeline prepared off the frame (`prepared`). */
export const preparedComputePipeline = (
  device: GPUDevice,
  descriptor: GPUComputePipelineDescriptor,
) =>
  prepared(
    descriptor,
    (d) => buildComputePipeline(device, d),
    (d) => device.createComputePipeline(d),
  );

/** `pipeline`, its compile started now off the thread with nothing awaiting it (#1362): a use
 *  before it lands compiles it at once (`prepared`). */
export function started<P extends { prepare(): Promise<void> }>(pipeline: P) {
  pipeline.prepare().catch(() => undefined);
  return pipeline;
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
