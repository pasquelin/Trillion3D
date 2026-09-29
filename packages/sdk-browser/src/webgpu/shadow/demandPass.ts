import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts';
import { SHADOW_DEMAND_GROUP, SHADOW_DEMAND_WGSL } from './demandWgsl.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Label of the demand pass, as a frame's passes are timed. */
export const SHADOW_DEMAND_PASS = 'Trillion3D shadow demand v1';

/** What the demand pass reads and writes, in binding order: the visibility buffer's depth, normals
 *  and surface flags, the deferred view uniform, the lights and their tile lists, the shadow
 *  records and page table, and the request buffer it marks. */
export type ShadowDemandInputs = readonly [
  depth: GPUTextureView,
  normalRough: GPUTextureView,
  flags: GPUTextureView,
  view: GPUBuffer,
  lights: GPUBuffer,
  tiles: GPUBuffer,
  shadows: GPUBuffer,
  requests: GPUBuffer,
];

const TEXTURES: GPUTextureSampleType[] = ['depth', 'unfilterable-float', 'uint'];
const BUFFERS: GPUBufferBindingType[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
];

/**
 * The per-pixel demand of shadow pages (`demandWgsl.ts`): its pipeline, compiled at prepare, and
 * a bind group made again only when what it binds moved. It owns no buffer: it reads the frame's
 * own and marks the request buffer the resolve records into, before the shadow pages are drawn.
 */
export async function createShadowDemand(device: GPUDevice) {
  const module = await createCheckedShaderModule(device, SHADOW_DEMAND_WGSL, SHADOW_DEMAND_PASS);
  const layout = device.createBindGroupLayout({
    label: SHADOW_DEMAND_PASS,
    entries: [
      ...TEXTURES.map((sampleType, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType },
      })),
      ...BUFFERS.map((type, at) => ({
        binding: TEXTURES.length + at,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    ],
  });
  const pipeline = device.createComputePipeline({
    label: SHADOW_DEMAND_PASS,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'markShadowDemand' },
  });
  const bound = createWebgpuBindIdentity();
  let group: GPUBindGroup | undefined;
  return {
    /** Marks the pages every pixel of a `width × height` image wants, into `inputs`' requests. */
    encode(encoder: GPUCommandEncoder, inputs: ShadowDemandInputs, width: number, height: number) {
      bound.next.length = 0;
      bound.next.push(...inputs);
      if (bound.moved() || !group)
        group = device.createBindGroup({
          label: SHADOW_DEMAND_PASS,
          layout,
          entries: inputs.map((resource, binding) => ({
            binding,
            resource: binding < TEXTURES.length ? resource : { buffer: resource as GPUBuffer },
          })) as GPUBindGroupEntry[],
        });
      const pass = encoder.beginComputePass({ label: SHADOW_DEMAND_PASS });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(
        Math.ceil(width / SHADOW_DEMAND_GROUP),
        Math.ceil(height / SHADOW_DEMAND_GROUP),
      );
      pass.end();
    },
  };
}

export type ShadowDemand = Awaited<ReturnType<typeof createShadowDemand>>;

/**
 * Marks, per pixel, the shadow pages this image's resolve reads: after its light lists, before any
 * page is drawn, into the request buffer just zeroed — the report the scheduler reads back names
 * them whatever the resolve then falls back to. Nothing without the pass, the pool or the lists.
 */
export function encodeShadowDemand(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { lights, gpu } = rt,
    { demand, pageRequests, shadows, tiles } = lights;
  if (!demand || !pageRequests || !shadows?.texture || !tiles?.buffer || !lights.buffer) return;
  if (!gpu.deferred || !gpu.surfaces || !gpu.depthView) return;
  const [, normalRough, , flags] = gpu.surfaces.views(),
    [width, height] = gpu.targetSize;
  const inputs: ShadowDemandInputs = [
    gpu.depthView,
    normalRough,
    flags,
    gpu.deferred.uniform,
    lights.buffer,
    tiles.buffer,
    shadows.dataBuffer,
    pageRequests.buffer,
  ];
  demand.encode(encoder, inputs, width, height);
}
