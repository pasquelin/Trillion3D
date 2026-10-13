// The creations of `fakeDevice()` beside its buffers (`fakeBuffers.ts`): a texture as the device
// makes it, a pipeline's group layouts, and the refusal a test asks of an allocation.
import { textureExtent } from '../../../packages/sdk-browser/src/gpu/core/textureBytes.ts'
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

/** A texture as the device makes it: its descriptor, its size read out — a `GPUExtent3D`, as a
 *  dictionary or a sequence —, the views made of it. */
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
      const seen = { format: descriptor.format, ...view }
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
