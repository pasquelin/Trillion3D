import { reflectionLayout } from '../../../packages/sdk-browser/src/reflections/gpu.ts';
import { BLEND_SHADER } from '../../../packages/sdk-browser/src/webgpu/blend/shader.ts';
import { createWebgpuBlendPipelines } from '../../../packages/sdk-browser/src/webgpu/blend/pipelines.ts';
import { BLEND_BINDINGS as B } from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts';
import { PROXY_HEADER_BYTES } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts';
import { ltcTable } from '../../../packages/sdk-core/src/lighting/ltcTable.ts';
import { ENVIRONMENT_COEFFICIENTS } from '../../../packages/sdk-core/src/scene/core/environment.ts';
import { mirrorProxy } from './mirrorProxy.ts';
import { ouvrirAppareil as openDevice } from '../probes/webgpuDevice.ts';
import { mirrorVertex, proxyOnlyReflection } from './blendMirrorVertex.ts';
/** Render the actual blend fragment with a known one-triangle resident proxy and face radiance. */
export async function blendMirror() {
  const opened = await openDevice();
  if (!opened) throw new Error('WebGPU adapter unavailable');
  const { device, erreurs: errors } = opened;
  const { blendBindGroupLayout } = await createWebgpuBlendPipelines(device, []);
  const buffer = (
    size = 256 * 1024,
    data?: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>,
  ) => {
    const result = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    if (data) device.queue.writeBuffer(result, 0, data);
    return result;
  };
  const zero = buffer();
  const lights = new Float32Array(4 + ENVIRONMENT_COEFFICIENTS * 4 + 8 + ltcTable().length + 20);
  lights.set(ltcTable(), 4 + ENVIRONMENT_COEFFICIENTS * 4 + 8);
  const lightBuffer = buffer(lights.byteLength, lights);
  const view = new Float32Array(36);
  view.set([0, 0, 1, 0], 16);
  const viewBuffer = buffer(144, view);
  const grid = new Uint32Array(256);
  new Float32Array(grid.buffer)[0] = 10;
  grid[7] = 1;
  const gridBuffer = buffer(1024, grid);
  const colours = new Float32Array([0.8, 0.2, 0.05, 1, 0.8, 0.2, 0.05, 1]);
  const cache = buffer(32, colours);
  const proxy = createGpuBounceProxy(device, mirrorProxy());
  const sampled = (format: GPUTextureFormat, green = 255) => {
    const texture = device.createTexture({
      size: [1, 1, 1],
      format,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST,
    });
    if (format === 'rgba8unorm')
      device.queue.writeTexture(
        { texture },
        new Uint8Array([255, green, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
    return texture.createView({ dimension: '2d-array' });
  };
  const colourView = sampled('rgba8unorm');
  const dataView = sampled('rgba8unorm', 0);
  const depthView = sampled('depth32float');
  const reflection = proxyOnlyReflection(device);
  const transmittance = sampled('rgba32float');
  const sampler = device.createSampler();
  const comparison = device.createSampler({ compare: 'less-equal' });
  const resources = new Map<number, GPUBindingResource>();
  for (let i = 0; i <= B.surfaceCache; i++) resources.set(i, { buffer: zero });
  for (const slot of B.color.lanes) resources.set(slot, colourView);
  for (const slot of B.data.lanes) resources.set(slot, dataView);
  const pages = new Uint32Array(256);
  pages[4] = 0x00010001;
  resources.set(B.color.pages, { buffer: buffer(1024, pages) });
  resources.set(B.data.pages, { buffer: buffer(1024, pages) });
  resources.set(B.sampler, sampler);
  resources.set(B.shadowSampler, comparison);
  resources.set(B.shadowAtlas, depthView);
  resources.set(B.shadowTranslucentDepth, depthView);
  resources.set(B.shadowTransmittance, transmittance);
  for (const [slot, value] of [
    [B.uniform, viewBuffer],
    [B.directLights, lightBuffer],
    [B.bounceGrid, gridBuffer],
    [B.proxy, proxy.buffer],
    [B.surfaceCache, cache],
  ] as const)
    resources.set(slot, { buffer: value });
  const group = device.createBindGroup({
    layout: blendBindGroupLayout,
    entries: [...resources].map(([binding, resource]) => ({ binding, resource })),
  });
  const width = 32;
  const target = device.createTexture({
    size: [width, width],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const feedback = device.createTexture({
    size: [width, width],
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const read = device.createBuffer({
    size: width * 256,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const compilation: string[] = [];
  async function render(code: string, rough = false, model = 0) {
    const compiled = await opened!.compile(code + mirrorVertex(rough ? 0.3 : 0, model));
    compilation.push(...compiled.compilation);
    if (compiled.compilation.length) return [];
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [blendBindGroupLayout, reflectionLayout(device)],
      }),
      vertex: { module: compiled.module, entryPoint: 'mirrorVertex' },
      fragment: {
        module: compiled.module,
        entryPoint: 'fs',
        targets: [{ format: 'rgba16float' }, { format: 'r32uint' }],
      },
      primitive: { topology: 'triangle-list' },
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [target, feedback].map((texture) => ({
        view: texture.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.setBindGroup(1, reflection.group);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture: target }, { buffer: read, bytesPerRow: 256 }, [
      width,
      width,
    ]);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const pixels = Array.from(new Uint16Array(read.getMappedRange().slice(0)));
    read.unmap();
    return pixels;
  }
  const term = 'rgb+=mirrorLighting(s.rgb,m,clamped,s.N,V,in.view);';
  if (!BLEND_SHADER.includes(term)) throw new Error('missing transparent mirror contribution');
  const families = [];
  for (const model of [1, 2])
    families.push([
      await render(BLEND_SHADER, false, model),
      await render(BLEND_SHADER.replace(term, ''), false, model),
    ]);
  const mirror = await render(BLEND_SHADER);
  const repeat = await render(BLEND_SHADER);
  const previous = await render(BLEND_SHADER.replace(term, ''));
  const rough = await render(BLEND_SHADER, true);
  const roughPrevious = await render(BLEND_SHADER.replace(term, ''), true);
  device.queue.writeBuffer(
    proxy.buffer,
    PROXY_HEADER_BYTES,
    new Float32Array([-0.45, -0.2, 1, 0.4, -0.2, 1, -0.45, 0.5, 1]),
  );
  device.queue.writeBuffer(cache, 0, new Float32Array([0.05, 0.8, 0.2, 1, 0.05, 0.8, 0.2, 1]));
  const second = await render(BLEND_SHADER);
  grid[7] = 0;
  device.queue.writeBuffer(gridBuffer, 0, grid);
  const off = await render(BLEND_SHADER);
  const offPrevious = await render(BLEND_SHADER.replace(term, ''));
  reflection.dispose();
  const info = await opened.fermer();
  return {
    mirror,
    families,
    second,
    rough,
    roughPrevious,
    repeat,
    previous,
    off,
    offPrevious,
    errors,
    compilation,
    adapter: info.court,
    width,
  };
}
