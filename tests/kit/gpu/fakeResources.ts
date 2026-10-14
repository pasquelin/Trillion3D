// The creations of `fakeDevice()` beside its buffers (`fakeBuffers.ts`): a texture as the device
// makes it, a pipeline's group layouts, and the refusal a test asks of an allocation.
import { textureExtent } from '../../../packages/sdk-browser/src/gpu/core/textureExtent.ts'
import {
  texelBytes,
  type RecordLayout,
} from '../../../packages/sdk-browser/src/gpu/core/recordLayout.ts'
import type { FakeDeviceOptions, FakeTexture } from './fakeRecords.ts'
import { untag } from './fakeWebgpuDevice.ts'

/** What a creation that refuses leaves, by `refuse`: a throw, or an out-of-memory error in the
 *  innermost scope open. */
export function refusing(refuse: FakeDeviceOptions['refuse'], scopes: Array<object | null>) {
  return (descriptor: GPUBufferDescriptor | GPUTextureDescriptor) => {
    const refusal = refuse?.(descriptor)
    if (refusal === 'throw') throw new Error('NO_MEMORY')
    if (refusal !== 'oom') return
    if (!scopes.length) throw new Error('fakeDevice: out of memory outside an error scope')
    scopes[scopes.length - 1] ??= { message: 'Out of memory' }
  }
}

/** The 32-bit integer formats a texture keeps words of: the record tables'. */
const RECORD_FORMATS = new Set<GPUTextureFormat>(['rgba32uint', 'r32uint'])

/** Words a texel of `texture`'s record format holds (`texelBytes`). */
const channelsOf = (texture: FakeTexture) =>
  texelBytes(texture.format as RecordLayout['format']) / 4

/** The words of a record-format texture, made at the first use: zeros before a write. */
export function textureWords(texture: FakeTexture) {
  texture.words ??= new Uint32Array(
    texture.width * texture.height * texture.depthOrArrayLayers * channelsOf(texture),
  )
  return texture.words
}

/** The words of `size` texels from `origin`, as `queue.writeTexture` lays them, written into a
 *  32-bit integer texture's own (`FakeTexture.words`): the record tables the kernels' doubles read
 *  (`../../../packages/sdk-browser/src/gpu/core/recordTexture.ts`). Another format keeps none. */
export function writeTexels(
  destination: GPUTexelCopyTextureInfo,
  data: BufferSource,
  layout: GPUTexelCopyBufferLayout,
  size: GPUExtent3D,
) {
  const texture = destination.texture as unknown as FakeTexture
  if (!RECORD_FORMATS.has(texture.format)) return
  const channels = channelsOf(texture),
    held = textureWords(texture)
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const [x, y, z] = originOf(destination.origin)
  const [width, rows, layers] = textureExtent(size)
  const rowBytes = layout.bytesPerRow ?? width * channels * 4,
    imageRows = layout.rowsPerImage ?? rows
  for (let layer = 0; layer < layers; layer++)
    for (let row = 0; row < rows; row++) {
      const from = (layout.offset ?? 0) + (layer * imageRows + row) * rowBytes,
        to = (((z + layer) * texture.height + y + row) * texture.width + x) * channels
      const words = new Uint32Array(bytes.slice(from, from + width * channels * 4).buffer)
      held.set(words, to)
    }
}

/** An origin, a dictionary or a sequence, as three numbers. */
function originOf(o: GPUOrigin3D = []) {
  if (Array.isArray(o)) return [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0]
  const d = o as GPUOrigin3DDict
  return [d.x ?? 0, d.y ?? 0, d.z ?? 0]
}

/** The words of `size` texels copied from one 32-bit integer texture into another, as
 *  `copyTextureToTexture` moves them: a record table's growth (`recordTexture.ts`). A source no
 *  write reached holds zeros; another format keeps none. */
export function copyTexels(
  from: GPUTexelCopyTextureInfo,
  to: GPUTexelCopyTextureInfo,
  size: GPUExtent3D,
) {
  const source = from.texture as unknown as FakeTexture,
    target = to.texture as unknown as FakeTexture
  if (!RECORD_FORMATS.has(target.format) || !source.words) return
  const channels = channelsOf(target),
    held = textureWords(target)
  const [sx, sy, sz] = originOf(from.origin),
    [tx, ty, tz] = originOf(to.origin),
    [width, rows, layers] = textureExtent(size)
  for (let layer = 0; layer < layers; layer++)
    for (let row = 0; row < rows; row++) {
      const at = (((sz + layer) * source.height + sy + row) * source.width + sx) * channels,
        into = (((tz + layer) * target.height + ty + row) * target.width + tx) * channels
      held.set(source.words.subarray(at, at + width * channels), into)
    }
}

/** A texture as the device makes it: its descriptor, its size read out — a `GPUExtent3D`, as a
 *  dictionary or a sequence —, the views made of it, each naming it (`texture`, not enumerated). */
export function texture(descriptor: GPUTextureDescriptor, destroyed: Array<{ label?: string }>) {
  const [width, height, depthOrArrayLayers] = textureExtent(descriptor.size)
  const made: FakeTexture = {
    ...descriptor,
    label: untag(descriptor.label),
    width,
    height,
    depthOrArrayLayers,
    mipLevelCount: descriptor.mipLevelCount ?? 1,
    views: [],
    createView(view?: GPUTextureViewDescriptor) {
      const seen = Object.defineProperty({ format: descriptor.format, ...view }, 'texture', {
        value: made,
      })
      made.views.push(seen)
      return seen
    },
    destroy: () => void destroyed.push(made),
  }
  return made
}

/** `pipeline` with its `getBindGroupLayout`: the layout its group `i` reads. Not enumerable, so a
 *  pipeline compares to its descriptor as it was made. */
export const withGroups = <P extends object>(pipeline: P, layout: GPUPipelineLayout | 'auto') =>
  Object.defineProperty(pipeline, 'getBindGroupLayout', {
    value: (i: number) =>
      [...((layout as Partial<GPUPipelineLayoutDescriptor>)?.bindGroupLayouts ?? [])][i] ?? {},
    writable: true,
    configurable: true,
  })

/** A write's descriptors as they stood when the queue read them, as a device reads them when called:
 *  a writer may fill the same ones again for its next write. */
export const readDescriptors = (
  destination: GPUTexelCopyTextureInfo,
  layout: GPUTexelCopyBufferLayout,
  size: GPUExtent3D,
) => ({
  destination: { ...destination, origin: copied(destination.origin) },
  layout: { ...layout },
  size: copied(size),
})

/** An origin or an extent as it stood: a list copied, a dictionary too. */
const copied = <T extends GPUOrigin3D | GPUExtent3D | undefined>(at: T): T =>
  (at === undefined
    ? at
    : Symbol.iterator in Object(at)
      ? [...(at as Iterable<number>)]
      : { ...at }) as T
