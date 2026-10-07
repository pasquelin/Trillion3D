import { checkGroup, checkLayout, checkPipelineLayout } from './bindRules.ts'
import {
  checkBuffer,
  checkClear,
  checkCopyBuffers,
  checkCopyTextures,
  checkResolve,
  checkTextureBufferCopy,
  checkTextureWrite,
  checkWriteBuffer,
} from './bufferRules.ts'
import type { Features } from './formats.ts'
import { bytesOf } from './globals.ts'
import { checkAttachment, checkTexture, checkView } from './textureRules.ts'
import { buffers, known, remember, resolve, samplers, textures, views } from './kitMade.ts'

/**
 * The validation every device of the kit applies — `fakeDevice`, `mockGpu` (through
 * `asWebgpuDevice`), the timing fixture —, in this one place: each creation, write and encoded
 * copy is checked by WebGPU's rules (`textureRules.ts`, `bufferRules.ts`, `bindRules.ts`) before
 * the device records it, and refused with an error naming the rule where a real device would
 * raise a validation error or be lost. What the kit makes is remembered (`kitMade.ts`), so a view,
 * a group or a copy is checked against the resources it names; a test's own object is not checked.
 */

const validated = new WeakSet<object>()

type Method = (...args: never[]) => unknown
type Owner = Record<string, unknown>
/** A copy's texture side, buffer side and extent, and a write's bytes, as WebGPU types them. */
type TextureAt = GPUTexelCopyTextureInfo
type BufferAt = GPUTexelCopyBufferInfo
type Extent = GPUExtent3DStrict
type Bytes = GPUAllowSharedBufferSource

/** Replaces `owner[name]`, when it has one, by the same call checked first, the call's arguments
 *  typed by `check`; `after` is given what it made and what the check returned. */
function guard<A extends unknown[], C>(
  owner: Owner,
  name: string,
  check: (...args: A) => C,
  after?: (made: unknown, checked: C) => void,
) {
  const make = owner[name] as ((this: unknown, ...args: A) => unknown) | undefined
  if (typeof make !== 'function') return
  owner[name] = function (this: unknown, ...args: A) {
    const checked = check(...args)
    const made = make.apply(this, args)
    after?.(made, checked)
    return made
  }
}

/** Checks every copy and attachment `encoder` takes. */
function guardEncoder(encoder: Owner, features: Features) {
  // Both overloads read as one, `(from, to, size?)` and `(from, fromOffset, to, toOffset, size?)`:
  // a size the second leaves out reaches the rule unchecked.
  guard(
    encoder,
    'copyBufferToBuffer',
    (from: GPUBuffer, a: GPUBuffer | number, b?: GPUBuffer | number, c?: number, d?: number) => {
      const [fromOffset, to, toOffset, size] = (
        typeof a === 'number' ? [a, b, c, d] : [0, a, 0, b ?? known(buffers, from)?.size ?? 0]
      ) as [number, GPUBuffer | number | undefined, number, number]
      checkCopyBuffers(known(buffers, from), fromOffset, known(buffers, to), toOffset, size)
    },
  )
  guard(encoder, 'clearBuffer', (buffer: GPUBuffer, offset?: number, size?: number) =>
    checkClear(known(buffers, buffer), offset ?? 0, size),
  )
  guard(encoder, 'copyTextureToBuffer', (source: TextureAt, destination: BufferAt, size: Extent) =>
    checkTextureBufferCopy(
      known(textures, source?.texture),
      known(buffers, destination?.buffer),
      destination ?? {},
      size,
      true,
    ),
  )
  guard(encoder, 'copyBufferToTexture', (source: BufferAt, destination: TextureAt, size: Extent) =>
    checkTextureBufferCopy(
      known(textures, destination?.texture),
      known(buffers, source?.buffer),
      source ?? {},
      size,
      false,
    ),
  )
  guard(encoder, 'copyTextureToTexture', (from: TextureAt, to: TextureAt) =>
    checkCopyTextures(known(textures, from?.texture), known(textures, to?.texture)),
  )
  guard(
    encoder,
    'resolveQuerySet',
    (_set: GPUQuerySet, _first: number, _count: number, destination: GPUBuffer, offset: number) =>
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
    (made, info) => {
      remember(textures, made, info)
      const texture = made as Owner | undefined
      const view = texture?.createView as Method | undefined
      if (typeof view !== 'function') return
      texture!.createView = (descriptor?: GPUTextureViewDescriptor) => {
        const viewInfo = checkView(info, descriptor, features)
        const result = (view as (d?: GPUTextureViewDescriptor) => object).call(texture, descriptor)
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
  guard(owner, 'createBindGroupLayout', (d: GPUBindGroupLayoutDescriptor) =>
    checkLayout(d, limits()),
  )
  guard(owner, 'createPipelineLayout', (d: GPUPipelineLayoutDescriptor) =>
    checkPipelineLayout(d, limits()),
  )
  guard(owner, 'createBindGroup', (d: GPUBindGroupDescriptor) => checkGroup(d, resolve, limits()))
  guard(
    owner,
    'createCommandEncoder',
    () => {},
    (made) => made && guardEncoder(made as Owner, features),
  )
  const queue = owner.queue as Owner | undefined
  if (queue && !validated.has(queue)) {
    validated.add(queue)
    guard(
      queue,
      'writeBuffer',
      (buffer: GPUBuffer, offset: number, data: Bytes, from?: number, size?: number) =>
        checkWriteBuffer(known(buffers, buffer), offset, bytesOf(data, from, size).byteLength),
    )
    guard(queue, 'writeTexture', (destination: TextureAt) =>
      checkTextureWrite(known(textures, destination?.texture)),
    )
    guard(
      queue,
      'copyExternalImageToTexture',
      (_source: GPUCopyExternalImageSourceInfo, destination: GPUCopyExternalImageDestInfo) =>
        checkTextureWrite(known(textures, destination?.texture), true),
    )
  }
  return device
}
