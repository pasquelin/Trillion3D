// The machines a bench run stands for. The GPU's speed stays this machine's: a profile sets what a
// device grants — its display, its limits, its features — so a run shows what the engine does, and
// whether it opens at all, on a device that grants no more than that.
import type { BenchDisplay } from './dom.ts'

/** The limits the WebGPU specification gives every device: what the most modest adapter grants. */
const BASELINE_LIMITS: Record<string, number> = {
  maxTextureDimension1D: 8192,
  maxTextureDimension2D: 8192,
  maxTextureDimension3D: 2048,
  maxTextureArrayLayers: 256,
  maxBindGroups: 4,
  maxBindingsPerBindGroup: 1000,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxUniformBufferBindingSize: 65536,
  maxStorageBufferBindingSize: 134217728,
  maxVertexBuffers: 8,
  maxBufferSize: 268435456,
  maxVertexAttributes: 16,
  maxVertexBufferArrayStride: 2048,
  maxInterStageShaderVariables: 16,
  maxColorAttachments: 8,
  maxColorAttachmentBytesPerSample: 32,
  maxComputeWorkgroupStorageSize: 16384,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupSizeZ: 64,
  maxComputeWorkgroupsPerDimension: 65535,
}

/** `desktop`: a desktop screen and all this GPU grants. `mobile`: a phone held sideways and the
 *  specification's limits. */
export const PROFILES: Record<
  string,
  { display: BenchDisplay; limits: Record<string, number> | null }
> = {
  desktop: { display: { width: 4112, height: 2294, ratio: 2 }, limits: null },
  mobile: { display: { width: 2532, height: 1170, ratio: 3 }, limits: BASELINE_LIMITS },
}

/**
 * The adapter as a device of `limits` (`null`: its own) without `featuresOff` sees it: its limits
 * at most those, its features without those, and a device asked of it refused beyond them — as
 * such an adapter would. `opened` hears each device it gives.
 */
export function profiledAdapter(
  adapter: GPUAdapter,
  limits: Record<string, number> | null,
  featuresOff: readonly string[],
  opened: (device: GPUDevice) => void,
) {
  const own = adapter.limits as unknown as Record<string, number>
  const clamped: Record<string, number> = {}
  const keys = new Set(Object.keys(BASELINE_LIMITS))
  for (const key in own) keys.add(key)
  for (const key of keys)
    clamped[key] =
      limits?.[key] === undefined
        ? own[key]
        : key.startsWith('min')
          ? Math.max(own[key], limits[key])
          : Math.min(own[key], limits[key])
  const features = new Set(
    [...adapter.features].filter((feature) => !featuresOff.includes(feature)),
  )
  const requestDevice = (descriptor: GPUDeviceDescriptor = {}) => {
    const asked = (descriptor.requiredLimits ?? {}) as Record<string, number>
    for (const key in asked)
      if (
        key in clamped &&
        (key.startsWith('min') ? asked[key] < clamped[key] : asked[key] > clamped[key])
      )
        return Promise.reject(
          new TypeError(`limit ${key} ${asked[key]} beyond the profile's ${clamped[key]}`),
        )
    const missing = [...(descriptor.requiredFeatures ?? [])].filter(
      (feature) => !features.has(feature),
    )
    if (missing.length)
      return Promise.reject(new TypeError(`features ${missing.join(', ')} off in the profile`))
    return adapter.requestDevice(descriptor).then((device) => (opened(device), device))
  }
  return new Proxy(adapter, {
    get(target, key) {
      if (key === 'limits') return clamped
      if (key === 'features') return features
      if (key === 'requestDevice') return requestDevice
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
