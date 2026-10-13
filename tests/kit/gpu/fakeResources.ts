// The creations of `fakeDevice()` beside its buffers (`fakeBuffers.ts`): a texture as the device
// makes it, a pipeline's group layouts, and the refusal a test asks of an allocation.
import { textureExtent } from '../../../packages/sdk-browser/src/gpu/core/textureExtent.ts'
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

/** Words a texel of a 32-bit integer format holds; none for another format. */
const WORD_TEXELS: Partial<Record<GPUTextureFormat, number>> = { rgba32uint: 4, r32uint: 1 }

/** The words of `size` texels from `origin`, as `queue.writeTexture` lays them, written into a
 *  32-bit integer texture's own (`FakeTexture.words`): the record tables the kernels' doubles read
 *  (`../../../packages/sdk-browser/src/gpu/core/recordTexture.ts`). Another format keeps none. */
export function writeTexels(
  destination: GPUTexelCopyTextureInfo,
  data: BufferSource,
  layout: GPUTexelCopyBufferLayout,
  size: GPUExtent3D,
) {
  const texture = destination.texture as unknown as FakeTexture,
    channels = WORD_TEXELS[texture.format]
  if (!channels) return
  texture.words ??= new Uint32Array(
    texture.width * texture.height * texture.depthOrArrayLayers * channels,
  )
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const o = destination.origin ?? [],
    [x, y, z] = Array.isArray(o)
      ? [o[0] ?? 0, o[1] ?? 0, o[2] ?? 0]
      : [
          (o as GPUOrigin3DDict).x ?? 0,
          (o as GPUOrigin3DDict).y ?? 0,
          (o as GPUOrigin3DDict).z ?? 0,
        ]
  const [width, rows, layers] = textureExtent(size)
  const rowBytes = layout.bytesPerRow ?? width * channels * 4,
    imageRows = layout.rowsPerImage ?? rows
  for (let layer = 0; layer < layers; layer++)
    for (let row = 0; row < rows; row++) {
      const from = (layout.offset ?? 0) + (layer * imageRows + row) * rowBytes,
        to = (((z + layer) * texture.height + y + row) * texture.width + x) * channels
      const words = new Uint32Array(bytes.slice(from, from + width * channels * 4).buffer)
      texture.words.set(words, to)
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
