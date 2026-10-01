import { computePass, type ComputeBinding } from './computePass.ts';
import { SHADOW_DEMAND_GROUP, shadowDemandWgsl } from './demandWgsl.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import {
  RECEIVER_BINDING_TYPES,
  receiverResources,
  type ReceiverResources,
} from '../visibility/receiver.ts';
import { SHADOW_DEMAND_PASS } from '../../stage/passLabels.ts';

/** What the demand pass reads and writes, in binding order: the visibility buffer's depth, normals
 *  and surface flags, the deferred view uniform, the lights and their tile lists, the shadow
 *  records and page table, the request buffer it marks, and what the pixels' shading-point offsets
 *  are recomputed from (`DEMAND_RECEIVER_BINDING`). */
type ShadowDemandInputs = readonly [
  depth: GPUTextureView,
  normalRough: GPUTextureView,
  flags: GPUTextureView,
  view: GPUBuffer,
  lights: GPUBuffer,
  tiles: GPUBuffer,
  shadows: GPUBuffer,
  requests: GPUBuffer,
  ...receiver: ReceiverResources,
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
  ...RECEIVER_BINDING_TYPES,
];

/**
 * The per-pixel demand of shadow pages (`demandWgsl.ts`): a compute pass of the shadow page
 * passes (`computePass.ts`), compiled at prepare for the session's window. It owns no buffer: it
 * reads the frame's own and marks the request buffer the resolve records into, before the shadow
 * pages are drawn.
 */
export const createShadowDemand = (device: GPUDevice, pages = SUN_WINDOW) =>
  computePass(device, shadowDemandWgsl(pages), SHADOW_DEMAND_PASS, 'markShadowDemand', BINDINGS);

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
  // No visibility buffer resolved: no lit pixel asks anything.
  const receiver = receiverResources(rt);
  if (!receiver) return;
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
    ...receiver,
  ];
  demand(encoder, inputs, [
    Math.ceil(width / SHADOW_DEMAND_GROUP),
    Math.ceil(height / SHADOW_DEMAND_GROUP),
  ]);
}
