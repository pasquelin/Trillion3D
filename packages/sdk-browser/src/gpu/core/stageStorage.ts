/** The shader stages whose storage buffer count a device limits on its own, besides the limit every stage shares. */
export type StorageStage = 'vertex' | 'fragment' | 'compute'

type StageLimits = GPUSupportedLimits & {
  maxStorageBuffersInVertexStage?: number
  maxStorageBuffersInFragmentStage?: number
}

/**
 * Whether `device` grants a `stage` `count` storage buffers: the fewer of the stage's own limit (none on a device that lists none: the
 * compute stage has none) and the shader stages' (8, WebGPU's guarantee, where the device lists none). The one answer every program that
 * binds more than the guarantee asks (the colour atlas read by a vertex stage, the page management's counters, the sorted translucency's buffer).
 */
export function grantsStageStorage(
  device: Pick<GPUDevice, 'limits'>,
  stage: StorageStage,
  count: number,
) {
  const limits = device.limits as StageLimits | undefined
  const own =
    stage === 'vertex'
      ? limits?.maxStorageBuffersInVertexStage
      : stage === 'fragment'
        ? limits?.maxStorageBuffersInFragmentStage
        : undefined
  return Math.min(limits?.maxStorageBuffersPerShaderStage ?? 8, own ?? Infinity) >= count
}
