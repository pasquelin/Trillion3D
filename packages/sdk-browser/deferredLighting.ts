import type { SurfaceBuffer } from './surfaceBuffer.ts';
import { DEFERRED_LIGHTING_SHADER, COMPOSE_SHADER } from './deferredLightingShaders.ts';
export { FULLSCREEN_VERTEX, DEFERRED_LIGHTING_SHADER } from './deferredLightingShaders.ts';

export async function createDeferredLighting(device: GPUDevice, lights: GPUBuffer) {
  const uniform = device.createBuffer({
    label: 'WG deferred view v1',
    size: 112,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const modules = [DEFERRED_LIGHTING_SHADER, COMPOSE_SHADER].map((code) =>
    device.createShaderModule({ code }),
  );
  try {
    for (const module of modules) {
      const info = await module.getCompilationInfo?.();
      const errors = info?.messages.filter((message) => message.type === 'error');
      if (errors?.length) throw new Error(errors.map((error) => error.message).join('\n'));
    }
    const entries: GPUBindGroupLayoutEntry[] = [0, 1, 2, 3, 4].map((binding) => ({
      binding,
      visibility: GPUShaderStage.FRAGMENT,
      texture: {
        sampleType: binding === 3 ? 'uint' : binding === 4 ? 'depth' : 'unfilterable-float',
      },
    }));
    entries.push(
      { binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 6, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    );
    const lightingLayout = device.createBindGroupLayout({ entries });
    const compositionLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'unfilterable-float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const make = (
      module: GPUShaderModule,
      bind: GPUBindGroupLayout,
      entryPoint: string,
      formats: GPUTextureFormat[],
    ) => {
      const descriptor: GPURenderPipelineDescriptor = {
        layout: device.createPipelineLayout({ bindGroupLayouts: [bind] }),
        vertex: { module, entryPoint: 'fullscreen' },
        fragment: { module, entryPoint, targets: formats.map((format) => ({ format })) },
        primitive: { topology: 'triangle-list' },
      };
      return device.createRenderPipelineAsync
        ? device.createRenderPipelineAsync(descriptor)
        : Promise.resolve(device.createRenderPipeline(descriptor));
    };
    const light = await make(modules[0], lightingLayout, 'lightSurface', ['rgba16float']),
      compose = await make(modules[1], compositionLayout, 'compose', ['rgba8unorm']);
    const composePresent = await make(modules[1], compositionLayout, 'composePresent', [
      'rgba8unorm',
      'bgra8unorm',
    ]);
    let boundSurface: SurfaceBuffer | undefined,
      lightGroup: GPUBindGroup | undefined,
      composeGroup: GPUBindGroup | undefined;
    const packed = new Float32Array(28);
    return {
      uniform,
      update(
        inverseViewProjection: readonly number[],
        camera: readonly number[],
        width: number,
        height: number,
        clearColor: number,
        diagnostic: boolean,
      ) {
        packed.set(inverseViewProjection, 0);
        packed.set(camera, 16);
        packed.set([width, height, diagnostic ? 1 : 0, 0], 20);
        packed.set(
          [(clearColor >> 16) / 255, ((clearColor >> 8) & 255) / 255, (clearColor & 255) / 255, 1],
          24,
        );
        device.queue.writeBuffer(uniform, 0, packed);
      },
      bind(surface: SurfaceBuffer, depth: GPUTextureView, hdr: GPUTextureView) {
        if (boundSurface === surface) return;
        boundSurface = surface;
        lightGroup = device.createBindGroup({
          layout: lightingLayout,
          entries: [
            ...surface.views().map((resource, binding) => ({ binding, resource })),
            { binding: 4, resource: depth },
            { binding: 5, resource: { buffer: uniform } },
            { binding: 6, resource: { buffer: lights } },
          ],
        });
        composeGroup = device.createBindGroup({
          layout: compositionLayout,
          entries: [
            { binding: 0, resource: hdr },
            { binding: 1, resource: { buffer: uniform } },
          ],
        });
      },
      light(encoder: GPUCommandEncoder, target: GPUTextureView) {
        if (!lightGroup) throw new Error('SURFACE_NOT_BOUND');
        const pass = encoder.beginRenderPass({
          label: 'WG deferred lighting',
          colorAttachments: [
            { view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] },
          ],
        });
        pass.setPipeline(light);
        pass.setBindGroup(0, lightGroup);
        pass.draw(3);
        pass.end();
      },
      compose(
        encoder: GPUCommandEncoder,
        target: GPUTextureView,
        clear: GPUColor,
        presentation?: GPUTextureView,
      ) {
        if (!composeGroup) throw new Error('SURFACE_NOT_BOUND');
        // Both UNORM targets receive the same display value. Keep the persistent
        // capture image while avoiding a separate fullscreen read and presentation.
        const colorAttachments: GPURenderPassColorAttachment[] = [
          { view: target, loadOp: 'clear', storeOp: 'store', clearValue: clear },
        ];
        if (presentation)
          colorAttachments.push({
            view: presentation,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: clear,
          });
        const pass = encoder.beginRenderPass({
          label: presentation ? 'WG HDR composition + present' : 'WG HDR composition',
          colorAttachments,
        });
        pass.setPipeline(presentation ? composePresent : compose);
        pass.setBindGroup(0, composeGroup);
        pass.draw(3);
        pass.end();
      },
      dispose() {
        uniform.destroy();
        boundSurface = undefined;
        lightGroup = composeGroup = undefined;
      },
    };
  } catch (error) {
    uniform.destroy();
    throw error;
  }
}
