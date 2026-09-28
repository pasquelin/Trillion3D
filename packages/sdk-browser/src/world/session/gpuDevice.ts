import { WEBGPU_REQUIRED_LIMITS } from '../../backend/common.ts';
import { BLOCK_FEATURES } from '../../texture/blockFormats.ts';

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
 * Test switch: the features `trillion3dGpuFeaturesOff=subgroups,shader-f16` names on the host
 * URL are never requested, so a device that could have them runs every kernel's plain path —
 * the proof of the fallback on the machine that has the feature.
 */
export function gpuFeaturesForcedOff(
  search = typeof location === 'undefined' ? '' : location.search,
): ReadonlySet<string> {
  const named = new URLSearchParams(search).get('trillion3dGpuFeaturesOff');
  return new Set(named ? named.split(',').map((name) => name.trim()) : []);
}

/** The WebGPU device of a session: the optional features offered and not forced off, and the
 *  adapter's own limits. */
export async function requestExplorerDevice(adapter: GPUAdapter, off = gpuFeaturesForcedOff()) {
  const features = OPTIONAL_GPU_FEATURES.filter(
    (feature) => adapter.features.has(feature) && !off.has(feature),
  );
  const adapterLimits = adapter.limits;
  const requiredLimits: Record<string, number> = {};
  for (const name of WEBGPU_REQUIRED_LIMITS) {
    const value = (adapterLimits as unknown as Record<string, number | undefined>)[name];
    if (typeof value === 'number' && Number.isFinite(value)) requiredLimits[name] = value;
  }
  return adapter.requestDevice({ requiredFeatures: features, requiredLimits });
}

/** The optional features `device` was granted, in request order: what the session publishes. */
export const grantedGpuFeatures = (device: GPUDevice) =>
  OPTIONAL_GPU_FEATURES.filter((feature) => device.features.has(feature));
