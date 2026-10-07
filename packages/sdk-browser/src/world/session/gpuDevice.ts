import { WEBGPU_REQUIRED_LIMITS } from '../../engine/common.ts'
import { BLOCK_FEATURES } from '../../texture/blockFormats.ts'

/**
 * Every optional feature the engine can use, in request order: instanced indirect draws, GPU
 * timestamps, subgroups (the light tiles' depth bounds), 16-bit shader floats, depth clipping
 * control (the shadow pool's sun casters, #26), clip distances (they spare a lamp's moving group
 * the overdraw past its page, #1345), and the block-compressed texture formats the cache bakes. A
 * kernel that uses one branches on the device's own `features` and keeps its plain path as the
 * fallback when it is absent; the session publishes what the device got
 * (`grantedGpuFeatures`), never guesses it.
 */
const OPTIONAL_GPU_FEATURES: readonly GPUFeatureName[] = [
  'indirect-first-instance',
  'timestamp-query',
  'subgroups',
  'shader-f16',
  'depth-clip-control',
  'clip-distances',
  ...Object.values(BLOCK_FEATURES),
]

/**
 * The WebGPU device of a session: the optional features the adapter offers, minus those the host
 * URL's test switch `trillion3dGpuFeaturesOff=subgroups,shader-f16` names (the proof, on a
 * machine that has them, of each shader variant written without them), and the adapter's own limits up to what the engine binds
 * (`WEBGPU_REQUIRED_LIMITS`).
 */
export async function requestExplorerDevice(
  adapter: GPUAdapter,
  search = typeof location === 'undefined' ? '' : location.search,
) {
  const off = new URLSearchParams(search).get('trillion3dGpuFeaturesOff')?.split(',') ?? []
  const features = OPTIONAL_GPU_FEATURES.filter(
    (feature) => adapter.features.has(feature) && !off.some((name) => name.trim() === feature),
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

/** The optional features `device` was granted, in request order: what the session publishes. */
export const grantedGpuFeatures = (device: GPUDevice) =>
  OPTIONAL_GPU_FEATURES.filter((feature) => device.features.has(feature))
