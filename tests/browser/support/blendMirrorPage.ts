import { BLEND_SHADER } from '../../../packages/sdk-browser/src/webgpu/blend/shader.ts';
import { createWebgpuBlendPipelines } from '../../../packages/sdk-browser/src/webgpu/blend/pipelines.ts';
import { BLEND_BINDINGS as B } from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts';
import { PROXY_HEADER_BYTES } from '../../../packages/sdk-browser/src/bounce/nodeWgsl.ts';
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts';
import { ltcTable } from '../../../packages/sdk-core/src/lighting/ltcTable.ts';
import { ENVIRONMENT_COEFFICIENTS } from '../../../packages/sdk-core/src/scene/core/environment.ts';
import type { SceneProxy } from '../../../packages/sdk-core/src/index.ts';
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';

// The shipped fragment is untouched. This vertex supplies an untextured standard metal plane
// at z=0, viewed orthographically from +z. A triangle at z=1 is visible only through reflection.
const VERTEX = `
@vertex fn mirrorVertex(@builtin(vertex_index) i:u32)->VSOut{
 var out:VSOut;
 let p=vec2f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1));
 out.position=vec4f(p,0.5,1.0);out.view=vec3f(p,0.0);
 out.normal=vec3f(0.0,0.0,1.0);out.color=vec4f(1.0);
 out.ids=vec3u(0u,17u,0u);out.pbr=vec4f(0.0,1.0,1.0,1.0);
 return out;
}`;

/** Render the actual blend fragment with a known one-triangle resident proxy and face radiance. */
export async function blendMirror() {
  const opened = await ouvrirAppareil();
  if (!opened) throw new Error('WebGPU adapter unavailable');
  const { device, erreurs } = opened;
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
  const proxy = createGpuBounceProxy(device, {
    triangles: 1,
    nodes: 1,
    data: {
      triangles: new Float32Array([-0.7, -0.6, 1, 0.6, -0.6, 1, -0.7, 0.71, 1]),
      albedo: new Uint32Array([0xffffffff]),
      nodeBounds: new Float32Array([-0.7, -0.6, 1, 0.6, 0.71, 1]),
      nodeChildren: new Uint32Array([0xff000000, 0x0101ffff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    },
  } as SceneProxy);
  const sampled = (format: GPUTextureFormat) => {
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
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
    return texture.createView({ dimension: '2d-array' });
  };
  const colourView = sampled('rgba8unorm');
  const depthView = sampled('depth32float');
  const transmittance = sampled('rgba32float');
  const sampler = device.createSampler();
  const comparison = device.createSampler({ compare: 'less-equal' });
  const resources = new Map<number, GPUBindingResource>();
  for (let i = 0; i <= B.surfaceCache; i++) resources.set(i, { buffer: zero });
  for (const slot of [...B.color.lanes, ...B.data.lanes]) resources.set(slot, colourView);
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
  async function render(code: string, rough = false) {
    const compiled = await opened!.compile(
      code + (rough ? VERTEX.replace('out.pbr=vec4f(0.0,', 'out.pbr=vec4f(0.3,') : VERTEX),
    );
    compilation.push(...compiled.compilation);
    if (compiled.compilation.length) return [];
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [blendBindGroupLayout] }),
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
  const term = '+mirrorLighting(rgb,m,clamped,s.N,V,in.view)';
  if (!BLEND_SHADER.includes(term)) throw new Error('missing transparent mirror contribution');
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
  const info = await opened.fermer();
  return {
    mirror,
    second,
    rough,
    roughPrevious,
    repeat,
    previous,
    off,
    offPrevious,
    errors: erreurs,
    compilation,
    adapter: info.court,
    width,
  };
}
