import { WEBGPU_REQUIRED_LIMITS } from './engine/common.ts'
import { BLOCK_FEATURES } from '../materials/texture/blockFormats.ts'
import { addressParam } from './host/addressFlag.ts'
import { WIDE_ATOMIC_FEATURE } from '../gpu/core/wideAtomics.ts'
import {
  TEXTURE_FORMATS_TIER1_FEATURE,
  TEXTURE_FORMATS_TIER2_FEATURE,
} from '../gpu/core/textureFormatsTier.ts'

/**
 * Every optional feature the engine can use, in request order: instanced indirect draws, GPU
 * timestamps, subgroups (the light tiles' depth bounds) and the control of their size (the temporal
 * pass's wave variants, `../post/taa/waveOps.ts`), 16-bit shader floats, depth clipping
 * control (the shadow pool's sun casters), clip distances (they spare a lamp's moving group
 * the overdraw past its page), dual-source blending (the water composite's per-channel
 * transmittance), 32-bit float textures read bilinearly (a 32-bit float sky light cubemap), the
 * 11-11-10, 8-bit and 16-bit formats stored to by a compute pass (the temporal history,
 * `../post/taa/historyShape.ts`; the feature carries the 11-11-10 format's drawing too), the 64-bit atomic maximum (the
 * visibility buffer's one-word write, `../gpu/core/wideAtomics.ts`), the 8-bit formats read and
 * written as storage textures (the global distance field's page atlas,
 * `../gpu/core/textureFormatsTier.ts`), and the block-compressed texture formats the cache bakes. A
 * kernel that uses one branches on the device's own `features` and keeps its plain path as the
 * fallback when it is absent; the session publishes what the device got
 * (`grantedGpuFeatures`), never guesses it.
 */
const OPTIONAL_GPU_FEATURES: readonly GPUFeatureName[] = [
  'indirect-first-instance',
  'timestamp-query',
  'subgroups',
  'subgroup-size-control',
  'shader-f16',
  'depth-clip-control',
  'clip-distances',
  'dual-source-blending',
  'float32-filterable',
  TEXTURE_FORMATS_TIER1_FEATURE,
  WIDE_ATOMIC_FEATURE,
  TEXTURE_FORMATS_TIER2_FEATURE,
  ...Object.values(BLOCK_FEATURES),
]

/** The features that carry another (§ 3.6.1.2 "Feature Dependencies" of the specification,
 *  https://www.w3.org/TR/webgpu/#feature-dependencies): a device created with one enables the other
 *  with it, so one named off takes the features that carry it off too. */
const CARRIED_BY: Readonly<Record<string, GPUFeatureName>> = {
  'subgroup-size-control': 'subgroups',
  [TEXTURE_FORMATS_TIER2_FEATURE]: TEXTURE_FORMATS_TIER1_FEATURE,
}

/** The features the address's test switch names off (`trillion3dGpuFeaturesOff`), as written. */
const featuresOffIn = (params: URLSearchParams) =>
  params.get('trillion3dGpuFeaturesOff')?.split(',') ?? []
/** Those of the page's address, read through the one address reader (`addressParam`). */
const gpuFeaturesOff = addressParam(featuresOffIn, [] as string[])

/**
 * The WebGPU device of a session: the optional features the adapter offers, minus those the host
 * URL's test switch `trillion3dGpuFeaturesOff=subgroups,shader-f16` names (the proof, on a
 * machine that has them, of each shader variant written without them), and the adapter's own limits up to what the engine binds
 * (`WEBGPU_REQUIRED_LIMITS`).
 */
export async function requestExplorerDevice(adapter: GPUAdapter, off = gpuFeaturesOff()) {
  const named = (feature: string) => off.some((name) => name.trim() === feature)
  const features = OPTIONAL_GPU_FEATURES.filter(
    (feature) =>
      adapter.features.has(feature) &&
      !named(feature) &&
      !(feature in CARRIED_BY && named(CARRIED_BY[feature])),
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
