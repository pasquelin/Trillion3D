/**
 * The limits a device holds and the per-stage counts a layout takes of them, as the kit's devices
 * check them (`bindRules.ts`): a fake device's limits are those its test granted, WebGPU's
 * defaults otherwise — 16 sampled textures, 8 storage buffers, 4 storage textures a stage.
 */

type Entry = GPUBindGroupLayoutEntry

/** The counts WebGPU grants a device that asks for none. */
const WEBGPU_DEFAULT_LIMITS = {
  maxBindGroups: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxSamplersPerShaderStage: 16,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxUniformBuffersPerShaderStage: 12,
  maxDynamicUniformBuffersPerPipelineLayout: 8,
  maxDynamicStorageBuffersPerPipelineLayout: 4,
  minUniformBufferOffsetAlignment: 256,
  minStorageBufferOffsetAlignment: 256,
  maxUniformBufferBindingSize: 65536,
}
export type CountedLimit = keyof typeof WEBGPU_DEFAULT_LIMITS

/** A limit as the device holds it: the one its test granted, WebGPU's default otherwise. */
export const limitOf = (name: CountedLimit, limits?: Record<string, number>) =>
  limits?.[name] ?? WEBGPU_DEFAULT_LIMITS[name]

/** The per-stage counts an entry takes, with the words a device names them by; an external
 *  texture takes four planes, their sampler and their parameters. */
function stageCounts(entry: Entry): [CountedLimit, string, number][] {
  if (entry.texture) return [['maxSampledTexturesPerShaderStage', 'sampled textures', 1]]
  if (entry.sampler) return [['maxSamplersPerShaderStage', 'samplers', 1]]
  if (entry.storageTexture) return [['maxStorageTexturesPerShaderStage', 'storage textures', 1]]
  if (entry.buffer)
    return (entry.buffer.type ?? 'uniform') === 'uniform'
      ? [['maxUniformBuffersPerShaderStage', 'uniform buffers', 1]]
      : [['maxStorageBuffersPerShaderStage', 'storage buffers', 1]]
  if (entry.externalTexture)
    return [
      ['maxSampledTexturesPerShaderStage', 'sampled textures', 4],
      ['maxSamplersPerShaderStage', 'samplers', 1],
      ['maxUniformBuffersPerShaderStage', 'uniform buffers', 1],
    ]
  return []
}

const STAGES: [GPUShaderStageFlags, string][] = [
  [1, 'Vertex'],
  [2, 'Fragment'],
  [4, 'Compute'],
]

/** Each stage's count of each kind over the groups of a pipeline layout, by limit name. */
export function stageBindingCounts(descriptor: GPUPipelineLayoutDescriptor) {
  const counts = new Map<string, { limit: CountedLimit; kind: string; count: number }>()
  for (const layout of [...descriptor.bindGroupLayouts]) {
    const entries = (layout as unknown as { entries?: Iterable<Entry> } | null)?.entries
    for (const entry of [...(entries ?? [])])
      for (const [limit, kind, count] of stageCounts(entry))
        for (const [bit, stage] of STAGES) {
          if (!(entry.visibility & bit)) continue
          const key = `${limit} ${stage}`
          const held = counts.get(key) ?? { limit, kind: `${kind} in the ${stage}`, count: 0 }
          counts.set(key, { ...held, count: held.count + count })
        }
  }
  return [...counts.values()]
}

/** No stage of `groups` — layouts, or their descriptors — binds more of a kind than the limit. */
export function checkStageLimits(
  where: string,
  groups: Iterable<unknown>,
  limits?: Record<string, number>,
) {
  const bindGroupLayouts = [...groups] as GPUBindGroupLayout[]
  for (const { limit, kind, count } of stageBindingCounts({ bindGroupLayouts })) {
    const max = limitOf(limit, limits)
    if (count > max)
      throw new Error(
        `${where}: the number of ${kind} stage (${count}) exceeds the maximum per-stage limit (${max}).`,
      )
  }
}
