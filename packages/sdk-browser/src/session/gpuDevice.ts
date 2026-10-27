import { WEBGPU_REQUIRED_LIMITS } from './engine/common.ts'
import { OPTIONAL_GPU_FEATURES, gpuFeaturesOff, isForcedOff } from '../gpu/core/gpuCaps.ts'

/**
 * The WebGPU device of a session: the optional features the adapter offers, minus those the host
 * URL's test switch `trillion3dGpuFeaturesOff=subgroups,shader-f16` names (the proof, on a
 * machine that has them, of each shader variant written without them), and the adapter's own limits up to what the engine binds
 * (`WEBGPU_REQUIRED_LIMITS`).
 */
export async function requestExplorerDevice(adapter: GPUAdapter, off = gpuFeaturesOff()) {
  const features = OPTIONAL_GPU_FEATURES.filter(
    (feature) => adapter.features.has(feature) && !isForcedOff(off, feature),
  )
  const adapterLimits = adapter.limits
  const requiredLimits: Record<string, number> = {}
  for (const [name, ceiling] of Object.entries(WEBGPU_REQUIRED_LIMITS)) {
    const value = (adapterLimits as unknown as Record<string, number | undefined>)[name]
    if (typeof value === 'number' && Number.isFinite(value))
      requiredLimits[name] = Math.min(value, ceiling)
  }
  return adapter.requestDevice({ requiredFeatures: features, requiredLimits })
}
