import { WEBGPU_REQUIRED_LIMITS } from '../../../packages/sdk-browser/src/backend/common.ts';

/**
 * The binding rules a device validates when a layout or a group is made, as the recording devices
 * of the kit check them: a storage texture's format must be one WebGPU stores to, read-write
 * access only on the 32-bit single-channel formats; a group binds every entry of its layout and
 * no other; a pipeline layout holds no more groups, and no stage more bindings of a kind, than the
 * device's limits. A test made with a layout that is no descriptor (`{}`) is not checked.
 */

/** The formats core WebGPU stores to (write-only or read-only access). */
const STORAGE_FORMATS = new Set(
  (
    'rgba8unorm rgba8snorm rgba8uint rgba8sint rgba16uint rgba16sint rgba16float r32uint r32sint ' +
    'r32float rg32uint rg32sint rg32float rgba32uint rgba32sint rgba32float bgra8unorm'
  ).split(' '),
);
/** The formats core WebGPU reads and writes in one binding. */
const READ_WRITE_FORMATS = new Set(['r32uint', 'r32sint', 'r32float']);

type Entry = GPUBindGroupLayoutEntry;

export function checkLayout(descriptor: GPUBindGroupLayoutDescriptor) {
  for (const entry of [...(descriptor.entries ?? [])] as Entry[]) {
    const storage = entry.storageTexture;
    if (!storage) continue;
    const where = `[BindGroupLayout "${descriptor.label ?? ''}"] binding ${entry.binding}`;
    if (!STORAGE_FORMATS.has(storage.format))
      throw new Error(`${where}: ${storage.format} is not a storage texture format`);
    if (storage.access === 'read-write' && !READ_WRITE_FORMATS.has(storage.format))
      throw new Error(`${where}: ${storage.format} cannot be bound read-write`);
  }
}

export function checkGroup(descriptor: GPUBindGroupDescriptor) {
  const layout = descriptor.layout as unknown as { label?: string; entries?: Entry[] };
  if (!layout?.entries) return;
  const where = `[BindGroup over "${layout.label ?? ''}"]`;
  const given = new Map([...descriptor.entries].map((e) => [e.binding, e.resource]));
  for (const entry of layout.entries)
    if (!given.has(entry.binding)) throw new Error(`${where}: binding ${entry.binding} missing`);
  if (given.size !== layout.entries.length)
    throw new Error(`${where}: ${given.size} entries for ${layout.entries.length} in the layout`);
}

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
};
type CountedLimit = keyof typeof WEBGPU_DEFAULT_LIMITS;

/** A count's limit on `limits`, else on the session's device made from an adapter that offers
 *  anything: its own ask (`WEBGPU_REQUIRED_LIMITS`), never below the default. */
const limitOf = (name: CountedLimit, limits?: Record<string, number>) =>
  limits?.[name] ??
  Math.max(
    WEBGPU_DEFAULT_LIMITS[name],
    (WEBGPU_REQUIRED_LIMITS as Partial<Record<CountedLimit, number>>)[name] ?? 0,
  );

/** The per-stage counts an entry takes, with the words a device names them by; an external
 *  texture takes four planes, their sampler and their parameters. */
function stageCounts(entry: Entry): [CountedLimit, string, number][] {
  if (entry.texture) return [['maxSampledTexturesPerShaderStage', 'sampled textures', 1]];
  if (entry.sampler) return [['maxSamplersPerShaderStage', 'samplers', 1]];
  if (entry.storageTexture) return [['maxStorageTexturesPerShaderStage', 'storage textures', 1]];
  if (entry.buffer)
    return (entry.buffer.type ?? 'uniform') === 'uniform'
      ? [['maxUniformBuffersPerShaderStage', 'uniform buffers', 1]]
      : [['maxStorageBuffersPerShaderStage', 'storage buffers', 1]];
  if (entry.externalTexture)
    return [
      ['maxSampledTexturesPerShaderStage', 'sampled textures', 4],
      ['maxSamplersPerShaderStage', 'samplers', 1],
      ['maxUniformBuffersPerShaderStage', 'uniform buffers', 1],
    ];
  return [];
}

const STAGES: [GPUShaderStageFlags, string][] = [
  [1, 'Vertex'],
  [2, 'Fragment'],
  [4, 'Compute'],
];

/** Each stage's count of each kind over the groups of a pipeline layout, by limit name. */
export function stageBindingCounts(descriptor: GPUPipelineLayoutDescriptor) {
  const counts = new Map<string, { limit: CountedLimit; kind: string; count: number }>();
  for (const layout of [...descriptor.bindGroupLayouts]) {
    const entries = (layout as unknown as { entries?: Iterable<Entry> } | null)?.entries;
    for (const entry of [...(entries ?? [])])
      for (const [limit, kind, count] of stageCounts(entry))
        for (const [bit, stage] of STAGES) {
          if (!(entry.visibility & bit)) continue;
          const key = `${limit} ${stage}`;
          const held = counts.get(key) ?? { limit, kind: `${kind} in the ${stage}`, count: 0 };
          counts.set(key, { ...held, count: held.count + count });
        }
  }
  return [...counts.values()];
}

export function checkPipelineLayout(
  descriptor: GPUPipelineLayoutDescriptor,
  limits?: Record<string, number>,
) {
  const where = `[PipelineLayout "${descriptor.label ?? ''}"]`;
  const groups = [...descriptor.bindGroupLayouts],
    maxGroups = limitOf('maxBindGroups', limits);
  if (groups.length > maxGroups)
    throw new Error(`${where}: ${groups.length} bind groups exceed the limit (${maxGroups}).`);
  for (const { limit, kind, count } of stageBindingCounts(descriptor)) {
    const max = limitOf(limit, limits);
    if (count > max)
      throw new Error(
        `${where}: the number of ${kind} stage (${count}) exceeds the maximum per-stage limit (${max}).`,
      );
  }
  const dynamic = { uniform: 0, storage: 0 };
  for (const layout of groups) {
    const entries = (layout as unknown as { entries?: Iterable<Entry> } | null)?.entries;
    for (const entry of [...(entries ?? [])])
      if (entry.buffer?.hasDynamicOffset)
        dynamic[(entry.buffer.type ?? 'uniform') === 'uniform' ? 'uniform' : 'storage']++;
  }
  for (const [kind, limit] of [
    ['uniform', 'maxDynamicUniformBuffersPerPipelineLayout'],
    ['storage', 'maxDynamicStorageBuffersPerPipelineLayout'],
  ] as const) {
    const max = limitOf(limit, limits);
    if (dynamic[kind] > max)
      throw new Error(
        `${where}: ${dynamic[kind]} dynamic ${kind} buffers exceed the limit (${max}).`,
      );
  }
}
