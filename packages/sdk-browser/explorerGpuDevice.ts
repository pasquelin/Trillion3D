import { WEBGPU_REQUIRED_LIMITS } from './backendCommon.ts';
import { BLOCK_FEATURES } from './textureBlockFormats.ts';

/**
 * The WebGPU device of a session: every optional feature the engine can use that the adapter
 * offers — instanced indirect draws, GPU timestamps, and the block-compressed texture formats
 * the cache bakes for it — and the adapter's own limits. A feature the adapter lacks is not
 * requested, and the engine publishes its absence where it matters (`texturePoolFormat`,
 * `gpuTiming`), never guesses it.
 */
export async function requestExplorerDevice(adapter: GPUAdapter) {
  const features: GPUFeatureName[] = [];
  const optional: GPUFeatureName[] = [
    'indirect-first-instance',
    'timestamp-query',
    ...Object.values(BLOCK_FEATURES),
  ];
  for (const feature of optional) if (adapter.features.has(feature)) features.push(feature);
  const adapterLimits = adapter.limits;
  const requiredLimits: Record<string, number> = {};
  for (const name of WEBGPU_REQUIRED_LIMITS) {
    const value = (adapterLimits as unknown as Record<string, number | undefined>)[name];
    if (typeof value === 'number' && Number.isFinite(value)) requiredLimits[name] = value;
  }
  return adapter.requestDevice({ requiredFeatures: features, requiredLimits });
}
