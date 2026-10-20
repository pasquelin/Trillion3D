// What the kit's devices made, remembered by object, so a view, a group or a copy is checked
// against the resources it names (`validation.ts`); a test's own object is not known here.
import type { Bound } from './bindRules.ts'
import type { BufferInfo } from './bufferRules.ts'
import type { TextureInfo, ViewInfo } from './textureRules.ts'

export const buffers = new WeakMap<object, BufferInfo>(),
  textures = new WeakMap<object, TextureInfo>(),
  views = new WeakMap<object, ViewInfo>(),
  samplers = new WeakSet<object>()

/** What the kit made of `value`, when it made it. */
export const known = <T>(map: WeakMap<object, T>, value: unknown) =>
  value && typeof value === 'object' ? map.get(value) : undefined

/** Remembers what the kit made, when it is an object. */
export const remember = <T>(map: WeakMap<object, T>, made: unknown, info: T) =>
  void (made && typeof made === 'object' && map.set(made, info))

/** A group's resource, read by what the kit made: a sampler, a view, a buffer or its binding. */
export function resolve(resource: unknown): Bound | undefined {
  if (!resource || typeof resource !== 'object') return undefined
  if (samplers.has(resource)) return { kind: 'sampler' }
  const view = views.get(resource)
  if (view) return { kind: 'view', info: view }
  const whole = buffers.get(resource)
  if (whole) return { kind: 'buffer', info: whole, offset: 0 }
  const { buffer, offset = 0, size } = resource as Partial<GPUBufferBinding>
  const info = known(buffers, buffer)
  return info && { kind: 'buffer', info, offset, size }
}
