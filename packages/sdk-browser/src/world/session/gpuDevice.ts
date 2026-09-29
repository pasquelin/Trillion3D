import { WEBGPU_REQUIRED_LIMITS } from '../../backend/common.ts';
import { BLOCK_FEATURES } from '../../texture/blockFormats.ts';
import { colorBytesPerSample } from '../../gpu/core/colorBytes.ts';
import { waterSurfaceTargets, WATER_ROUTED_TARGETS } from '../../webgpu/water/pipelines.ts';
import { shadeTargetFormats } from '../../webgpu/visibility/pipelines.ts';
import { blendTargets } from '../../webgpu/blend/pipelines.ts';

const formatsOf = (targets: readonly (GPUColorTargetState | null)[]) =>
  targets.map((target) => target?.format);

/** The colour bytes per sample of the engine's widest pass, from each pass's own targets: the
 *  water surface stage, the opaque shade, a filtered blend with its share, the routed water
 *  composite. WebGPU's default (32) is below the water surface stage's. */
export const engineColorBytesPerSample = () =>
  Math.max(
    colorBytesPerSample(formatsOf(waterSurfaceTargets(true))),
    colorBytesPerSample(shadeTargetFormats(true)),
    colorBytesPerSample(formatsOf(blendTargets('normal', 0xf, true, true, true))),
    colorBytesPerSample(formatsOf(WATER_ROUTED_TARGETS)),
  );

/**
 * Every optional feature the engine can use, in request order: instanced indirect draws, GPU
 * timestamps, subgroups (the light tiles' depth bounds), 16-bit shader floats, and the
 * block-compressed texture formats the cache bakes. A kernel that uses one branches on the
 * device's own `features` and keeps its plain path as the fallback when it is absent; the session
 * publishes what the device got (`grantedGpuFeatures`), never guesses it.
 */
const OPTIONAL_GPU_FEATURES: readonly GPUFeatureName[] = [
  'indirect-first-instance',
  'timestamp-query',
  'subgroups',
  'shader-f16',
  ...Object.values(BLOCK_FEATURES),
];

/**
 * The WebGPU device of a session: the optional features the adapter offers, minus those the host
 * URL's test switch `trillion3dGpuFeaturesOff=subgroups,shader-f16` names (the fallback's proof on
 * a machine that has them), and the adapter's own limits.
 */
export async function requestExplorerDevice(
  adapter: GPUAdapter,
  search = typeof location === 'undefined' ? '' : location.search,
) {
  const off = new URLSearchParams(search).get('trillion3dGpuFeaturesOff')?.split(',') ?? [];
  const features = OPTIONAL_GPU_FEATURES.filter(
    (feature) => adapter.features.has(feature) && !off.some((name) => name.trim() === feature),
  );
  const adapterLimits = adapter.limits;
  const requiredLimits: Record<string, number> = {};
  for (const name of WEBGPU_REQUIRED_LIMITS) {
    const value = (adapterLimits as unknown as Record<string, number | undefined>)[name];
    if (typeof value === 'number' && Number.isFinite(value)) requiredLimits[name] = value;
  }
  // Up to what the adapter offers: one that offers less still refuses the water pass by name.
  const colorBytes = adapterLimits.maxColorAttachmentBytesPerSample;
  if (typeof colorBytes === 'number' && Number.isFinite(colorBytes))
    requiredLimits.maxColorAttachmentBytesPerSample = Math.min(
      engineColorBytesPerSample(),
      colorBytes,
    );
  return adapter.requestDevice({ requiredFeatures: features, requiredLimits });
}

/** The optional features `device` was granted, in request order: what the session publishes. */
export const grantedGpuFeatures = (device: GPUDevice) =>
  OPTIONAL_GPU_FEATURES.filter((feature) => device.features.has(feature));
