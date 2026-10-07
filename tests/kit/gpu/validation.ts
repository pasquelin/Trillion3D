import { checkGroup, checkLayout, checkPipelineLayout, type Bound } from './bindRules.ts'
import {
  checkBuffer,
  checkClear,
  checkCopyBuffers,
  checkCopyTextures,
  checkResolve,
  checkTextureBufferCopy,
  checkTextureWrite,
  checkWriteBuffer,
  type BufferInfo,
} from './bufferRules.ts'
import type { Features } from './formats.ts'
import { bytesOf } from './globals.ts'
import {
  checkAttachment,
  checkTexture,
  checkView,
  type TextureInfo,
  type ViewInfo,
} from './textureRules.ts'

/**
 * The validation every device of the kit applies — `fakeDevice`, `mockGpu` (through
 * `asWebgpuDevice`), the timing fixture —, in this one place: each creation, write and encoded
 * copy is checked by WebGPU's rules (`textureRules.ts`, `bufferRules.ts`, `bindRules.ts`) before
 * the device records it, and refused with an error naming the rule where a real device would
 * raise a validation error or be lost. What the kit makes is remembered here, so a view, a group
 * or a copy is checked against the resources it names; a test's own object is not checked.
 */

const buffers = new WeakMap<object, BufferInfo>(),
  textures = new WeakMap<object, TextureInfo>(),
  views = new WeakMap<object, ViewInfo>(),
  samplers = new WeakSet<object>(),
  validated = new WeakSet<object>()

/** What the kit made of `value`, when it made it. */
const known = <T>(map: WeakMap<object, T>, value: unknown) =>
  value && typeof value === 'object' ? map.get(value) : undefined

/** Remembers what the kit made, when it is an object. */
const remember = <T>(map: WeakMap<object, T>, made: unknown, info: T) =>
  void (made && typeof made === 'object' && map.set(made, info))

/** A group's resource, read by what the kit made: a sampler, a view, a buffer or its binding. */
function resolve(resource: unknown): Bound | undefined {
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

type Method = (...args: never[]) => unknown
type Owner = Record<string, unknown>

/** Replaces `owner[name]`, when it has one, by the same call checked first; `after` is given what
 *  it made and what the check returned. */
function guard<C>(
  owner: Owner,
  name: string,
  check: (...args: any[]) => C,
  after?: (made: any, checked: C) => void,
) {
  const make = owner[name] as Method | undefined
  if (typeof make !== 'function') return
  owner[name] = function (this: unknown, ...args: never[]) {
    const checked = check(...args)
    const made = make.apply(this, args)
    after?.(made, checked)
    return made
  }
}

/** Checks every copy and attachment `encoder` takes. */
function guardEncoder(encoder: Owner, features: Features) {
  guard(encoder, 'copyBufferToBuffer', (from, a, b, c, d) => {
    const [fromOffset, to, toOffset, size] =
      typeof a === 'number' ? [a, b, c, d] : [0, a, 0, b ?? known(buffers, from)?.size ?? 0]
    checkCopyBuffers(known(buffers, from), fromOffset, known(buffers, to), toOffset, size)
  })
  guard(encoder, 'clearBuffer', (buffer, offset = 0, size?: number) =>
    checkClear(known(buffers, buffer), offset, size),
  )
  guard(encoder, 'copyTextureToBuffer', (source, destination, size) =>
    checkTextureBufferCopy(
      known(textures, source?.texture),
      known(buffers, destination?.buffer),
      destination ?? {},
      size,
      true,
    ),
  )
  guard(encoder, 'copyBufferToTexture', (source, destination, size) =>
    checkTextureBufferCopy(
      known(textures, destination?.texture),
      known(buffers, source?.buffer),
      source ?? {},
      size,
      false,
    ),
  )
  guard(encoder, 'copyTextureToTexture', (from, to) =>
    checkCopyTextures(known(textures, from?.texture), known(textures, to?.texture)),
  )
  guard(encoder, 'resolveQuerySet', (_set, _first, _count, destination, offset) =>
    checkResolve(known(buffers, destination), offset),
  )
  guard(encoder, 'beginRenderPass', (descriptor?: GPURenderPassDescriptor) => {
    const attachments = [
      ...[...(descriptor?.colorAttachments ?? [])].map((color) => color?.view),
      descriptor?.depthStencilAttachment?.view,
    ]
    for (const view of attachments) {
      const info = known(views, view)
      if (info) checkAttachment(info, features)
    }
  })
}

/**
 * Makes `device` — a kit device's members, before they are handed out — validate as WebGPU does:
 * its limits and features are read from it at each call. Applied once per device.
 */
export function validating<T extends object>(device: T): T {
  if (validated.has(device)) return device
  validated.add(device)
  const owner = device as Owner
  // Read at each call: a test may grant its device a feature after making it.
  const features: Features = {
    has: (name) => !!(owner.features as Features | undefined)?.has?.(name),
  }
  const limits = () => owner.limits as Record<string, number> | undefined
  guard(owner, 'createBuffer', checkBuffer, (made, info) => remember(buffers, made, info))
  guard(
    owner,
    'createTexture',
    (descriptor: GPUTextureDescriptor) => checkTexture(descriptor, features),
    (made: Owner | undefined, info) => {
      remember(textures, made, info)
      const view = made?.createView as Method | undefined
      if (typeof view !== 'function') return
      made!.createView = (descriptor?: GPUTextureViewDescriptor) => {
        const viewInfo = checkView(info, descriptor, features)
        const result = (view as (d?: GPUTextureViewDescriptor) => object).call(made, descriptor)
        remember(views, result, viewInfo)
        return result
      }
    },
  )
  guard(
    owner,
    'createSampler',
    () => {},
    (made) => {
      if (made && typeof made === 'object') samplers.add(made)
    },
  )
  guard(owner, 'createBindGroupLayout', (d) => checkLayout(d, limits()))
  guard(owner, 'createPipelineLayout', (d) => checkPipelineLayout(d, limits()))
  guard(owner, 'createBindGroup', (d) => checkGroup(d, resolve, limits()))
  guard(
    owner,
    'createCommandEncoder',
    () => {},
    (made) => made && guardEncoder(made, features),
  )
  const queue = owner.queue as Owner | undefined
  if (queue && !validated.has(queue)) {
    validated.add(queue)
    guard(queue, 'writeBuffer', (buffer, offset, data, dataOffset, size) =>
      checkWriteBuffer(known(buffers, buffer), offset, bytesOf(data, dataOffset, size).byteLength),
    )
    guard(queue, 'writeTexture', (destination) =>
      checkTextureWrite(known(textures, destination?.texture)),
    )
    guard(queue, 'copyExternalImageToTexture', (_source, destination) =>
      checkTextureWrite(known(textures, destination?.texture), true),
    )
  }
  return device
}
