import { computePass, type ComputeBinding } from './computePass.ts';
import { SHADOW_DEMAND_GROUP, SHADOW_DEMAND_WGSL } from './demandWgsl.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Label of the demand pass, as a frame's passes are timed. */
export const SHADOW_DEMAND_PASS = 'Trillion3D shadow demand v1';

/** What the demand pass reads and writes, in binding order: the visibility buffer's depth, normals
 *  and surface flags, the deferred view uniform, the lights and their tile lists, the shadow
 *  records and page table, and the request buffer it marks. */
type ShadowDemandInputs = readonly [
  depth: GPUTextureView,
  normalRough: GPUTextureView,
  flags: GPUTextureView,
  view: GPUBuffer,
  lights: GPUBuffer,
  tiles: GPUBuffer,
  shadows: GPUBuffer,
  requests: GPUBuffer,
];

const BINDINGS: ComputeBinding[] = [
  { texture: 'depth' },
  { texture: 'unfilterable-float' },
  { texture: 'uint' },
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
];

/**
 * The per-pixel demand of shadow pages (`demandWgsl.ts`): a compute pass of the shadow page
 * passes (`computePass.ts`), compiled at prepare. It owns no buffer: it reads the frame's own and
 * marks the request buffer the resolve records into, before the shadow pages are drawn.
 */
export const createShadowDemand = (device: GPUDevice) =>
  computePass(device, SHADOW_DEMAND_WGSL, SHADOW_DEMAND_PASS, 'markShadowDemand', BINDINGS);

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
  demand(encoder, inputs, [
    Math.ceil(width / SHADOW_DEMAND_GROUP),
    Math.ceil(height / SHADOW_DEMAND_GROUP),
  ]);
}
