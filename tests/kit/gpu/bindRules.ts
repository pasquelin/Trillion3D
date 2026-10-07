import { BUFFER, READ_WRITE_FORMATS, STORAGE_FORMATS, TEXTURE } from './formats.ts'
import type { BufferInfo } from './bufferRules.ts'
import type { ViewInfo } from './textureRules.ts'

import { checkStageLimits, limitOf } from './limitRules.ts'

export { checkView } from './textureRules.ts'
export { stageBindingCounts } from './limitRules.ts'

/**
 * The binding rules a device validates when a layout, a group or a pipeline layout is made, as the
 * kit's devices check them (`validation.ts`): a storage texture's format is one WebGPU stores to,
 * read-write access only on the 32-bit single-channel formats; a group binds every entry of its
 * layout and no other, each with a resource of the entry's kind — a buffer with the entry's usage
 * at an aligned offset, a view with texture or storage binding in its usage (a storage view in the
 * entry's format, one mip), a sampler —; a layout, and a pipeline layout over all its groups,
 * holds no more groups, and no stage more bindings of a kind, than the device's limits: those its
 * test granted, WebGPU's defaults otherwise. A group over a layout that is no descriptor (`{}`),
 * or a resource the kit did not make, is not checked.
 */

type Entry = GPUBindGroupLayoutEntry

export function checkLayout(
  descriptor: GPUBindGroupLayoutDescriptor,
  limits?: Record<string, number>,
) {
  for (const entry of [...(descriptor.entries ?? [])] as Entry[]) {
    const storage = entry.storageTexture
    if (!storage) continue
    const where = `[BindGroupLayout "${descriptor.label ?? ''}"] binding ${entry.binding}`
    if (!STORAGE_FORMATS.has(storage.format))
      throw new Error(`${where}: ${storage.format} is not a storage texture format`)
    if (storage.access === 'read-write' && !READ_WRITE_FORMATS.has(storage.format))
      throw new Error(`${where}: ${storage.format} cannot be bound read-write`)
  }
  checkStageLimits(`[BindGroupLayout "${descriptor.label ?? ''}"]`, [descriptor], limits)
}

/** What a group's resource is, when the kit made it: a buffer bound at `offset`, `size` bytes, a
 *  texture view, or a sampler. */
export type Bound =
  | { kind: 'buffer'; info: BufferInfo; offset: number; size?: number }
  | { kind: 'view'; info: ViewInfo }
  | { kind: 'sampler' }

/** The kind of resource a layout entry takes: a texture, storage or external entry takes a view. */
const kindOf = (entry: Entry) => (entry.buffer ? 'buffer' : entry.sampler ? 'sampler' : 'view')

function checkBinding(where: string, entry: Entry, bound: Bound, limits?: Record<string, number>) {
  const kind = kindOf(entry)
  if (bound.kind !== kind) throw new Error(`${where}: a ${bound.kind} bound to a ${kind} entry`)
  if (bound.kind === 'buffer') {
    const uniform = (entry.buffer!.type ?? 'uniform') === 'uniform'
    const flag = uniform ? BUFFER.UNIFORM : BUFFER.STORAGE,
      { info, offset } = bound
    if (!(info.usage & flag))
      throw new Error(`${where}: usage ${info.usage} lacks ${uniform ? 'Uniform' : 'Storage'}`)
    const align = uniform
      ? limitOf('minUniformBufferOffsetAlignment', limits)
      : limitOf('minStorageBufferOffsetAlignment', limits)
    if (offset % align) throw new Error(`${where}: offset ${offset} not aligned to ${align}`)
    const size = bound.size ?? info.size - offset
    if (!(size > 0 && offset + size <= info.size))
      throw new Error(`${where}: ${offset}+${size} bytes of a ${info.size}-byte buffer`)
    if (!uniform && size % 4) throw new Error(`${where}: storage binding of ${size} bytes`)
    const max = limitOf('maxUniformBufferBindingSize', limits)
    if (uniform && size > max)
      throw new Error(`${where}: a uniform binding of ${size} > ${max} bytes`)
  } else if (bound.kind === 'view') {
    const { usage, format, mips } = bound.info,
      storage = entry.storageTexture
    const [flag, word] = storage
      ? [TEXTURE.STORAGE_BINDING, 'StorageBinding']
      : [TEXTURE.TEXTURE_BINDING, 'TextureBinding']
    if (!(usage & flag)) throw new Error(`${where}: the view's usage ${usage} lacks ${word}`)
    if (storage && (format !== storage.format || !STORAGE_FORMATS.has(format)))
      throw new Error(`${where}: a ${format} view bound as a ${storage.format} storage texture`)
    if (storage && mips !== 1) throw new Error(`${where}: a storage view of ${mips} mips`)
  }
}

export function checkGroup(
  descriptor: GPUBindGroupDescriptor,
  resolve: (resource: unknown) => Bound | undefined = () => undefined,
  limits?: Record<string, number>,
) {
  const layout = descriptor.layout as unknown as { label?: string; entries?: Entry[] }
  if (!layout?.entries) return
  const where = `[BindGroup over "${layout.label ?? ''}"]`
  const given = new Map([...descriptor.entries].map((e) => [e.binding, e.resource]))
  for (const entry of layout.entries) {
    if (!given.has(entry.binding)) throw new Error(`${where}: binding ${entry.binding} missing`)
    const bound = resolve(given.get(entry.binding))
    if (bound) checkBinding(`${where} binding ${entry.binding}`, entry, bound, limits)
  }
  if (given.size !== layout.entries.length)
    throw new Error(`${where}: ${given.size} entries for ${layout.entries.length} in the layout`)
}

export function checkPipelineLayout(
  descriptor: GPUPipelineLayoutDescriptor,
  limits?: Record<string, number>,
) {
  const where = `[PipelineLayout "${descriptor.label ?? ''}"]`
  const groups = [...descriptor.bindGroupLayouts],
    maxGroups = limitOf('maxBindGroups', limits)
  if (groups.length > maxGroups)
    throw new Error(`${where}: ${groups.length} bind groups exceed the limit (${maxGroups}).`)
  checkStageLimits(where, groups, limits)
  const dynamic = { uniform: 0, storage: 0 }
  for (const layout of groups) {
    const entries = (layout as unknown as { entries?: Iterable<Entry> } | null)?.entries
    for (const entry of [...(entries ?? [])])
      if (entry.buffer?.hasDynamicOffset)
        dynamic[(entry.buffer.type ?? 'uniform') === 'uniform' ? 'uniform' : 'storage']++
  }
  for (const [kind, limit] of [
    ['uniform', 'maxDynamicUniformBuffersPerPipelineLayout'],
    ['storage', 'maxDynamicStorageBuffersPerPipelineLayout'],
  ] as const) {
    const max = limitOf(limit, limits)
    if (dynamic[kind] > max)
      throw new Error(
        `${where}: ${dynamic[kind]} dynamic ${kind} buffers exceed the limit (${max}).`,
      )
  }
}
