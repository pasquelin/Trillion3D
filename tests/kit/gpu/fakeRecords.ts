/** What `fakeDevice()` records and the options it takes, apart so the device stays readable. */
import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'

export type Numbers =
  Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array

/** A buffer as the fake creates it: its descriptor, its bytes — what writes, copies, clears and
 *  the kernels the device runs leave there —, mapped in place. */
export type FakeBuffer = {
  label?: string
  size: number
  usage: number
  data: Uint8Array
  mapAsync(): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
  destroy(): void
}
/** A texture as the fake creates it: its descriptor with its size read out, and the views made of
 *  it, each its descriptor over the texture's format. */
export type FakeTexture = GPUTextureDescriptor & {
  width: number
  height: number
  depthOrArrayLayers: number
  mipLevelCount: number
  views: GPUTextureViewDescriptor[]
  createView(descriptor?: GPUTextureViewDescriptor): GPUTextureViewDescriptor
  destroy(): void
}
/** One `queue.writeBuffer`: `data` is a copy taken at the call, an `ArrayBuffer` as bytes; `size`
 *  the write's own, in elements of `data`; `seq` its rank among the queue's writes and submits. */
export type FakeWrite = {
  buffer: GPUBuffer
  offset: number
  data: Numbers
  dataOffset: number
  size?: number
  seq: number
}
/** One `queue.writeTexture`: its destination, a copy of its bytes, its layout and extent, and its
 *  rank among the queue's writes and submits. */
export type FakeTextureWrite = {
  destination: GPUTexelCopyTextureInfo
  data: Numbers
  layout: GPUTexelCopyBufferLayout
  size: GPUExtent3D
  seq: number
}
/** One `copyBufferToBuffer` an encoder recorded, in the order it was encoded. */
export type FakeCopy = {
  from: GPUBuffer
  fromOffset: number
  to: GPUBuffer
  toOffset: number
  size: number
}
/** One `copyTextureToTexture` an encoder recorded, in the order it was encoded. */
export type FakeTextureCopy = {
  from: GPUTexelCopyTextureInfo
  to: GPUTexelCopyTextureInfo
  size: GPUExtent3D
}
/** One `copyTextureToBuffer` or `copyBufferToTexture` an encoder recorded, in order. */
export type FakeTextureBufferCopy = {
  source: GPUTexelCopyTextureInfo | GPUTexelCopyBufferInfo
  destination: GPUTexelCopyTextureInfo | GPUTexelCopyBufferInfo
  size: GPUExtent3D
}
/** One `resolveQuerySet` an encoder recorded, in order. */
export type FakeResolve = {
  querySet: GPUQuerySet
  first: number
  count: number
  destination: GPUBuffer
  offset: number
}
/** What a device's loss says, as WebGPU's `GPUDeviceLostInfo`. */
export type LostInfo = { reason: string; message: string }

/** The window of `data` a write sent: `dataOffset` and `size` count elements of `data`. */
export const written = ({ data, dataOffset, size }: FakeWrite) =>
  data.subarray(dataOffset, size === undefined ? undefined : dataOffset + size)

/** The bytes a write sent, where they sit in its copy (`written`, read as bytes). */
export const writtenBytes = (write: FakeWrite) => {
  const data = written(write)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/** Applies the writes to `bytes`, the buffer's own copy, in order, then forgets them. */
export function replayWrites(bytes: ArrayBuffer, writes: FakeWrite[]) {
  for (const write of writes.splice(0)) {
    const data = written(write)
    new Uint8Array(bytes, write.offset, data.byteLength).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    )
  }
}

export const copyOf = (data: BufferSource): Numbers =>
  data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : (data as Numbers).slice()

/** A buffer or texture creation `refuse` is asked about, and how it fails: `'throw'` throws
 *  `NO_MEMORY` at the call; `'oom'` returns the resource and leaves an out-of-memory error in the
 *  innermost error scope open, as a driver does. */
type Refusal = 'throw' | 'oom' | undefined
export type FakeDeviceOptions = {
  /** The device's `limits`, absent when not given. */
  limits?: Record<string, number>
  refuse?: (descriptor: GPUBufferDescriptor | GPUTextureDescriptor) => Refusal
  /** `false`: the device has no compute pipelines, as a device without compute. */
  compute?: boolean
  /** `false`: the device builds its pipelines at the call alone, offering no `…Async`. */
  asyncPipelines?: boolean
  /** Every buffer's `mapAsync` settles when this does; at once when not given. */
  mapping?: Promise<void>
  /** Every mapping refuses (`MAP_FAILED`), the explicit capture's but. */
  failMap?: boolean
  /** The features the device granted; none when not given. */
  features?: readonly GPUFeatureName[]
  /** The DAG the selection kernels the device runs read when the session uploads none. */
  packed?: PackedDag
  /** A render pipeline whose first target is `r32uint` is refused (`NO_R32UINT`). */
  rejectR32?: boolean
  /** The first visibility pass is refused at its beginning (`VIS_FAIL`). */
  failVisPass?: boolean
  /** The transparent compaction's pipeline is refused (`NO_COMPACT`). */
  failCompact?: boolean
  /** Every shader module reports a compilation error. */
  failCompile?: boolean
}

/** A pages backend run whole on the device: a MiB a buffer and a binding, its pipelines built at
 *  the call, as a software adapter does. */
export const BACKEND: FakeDeviceOptions = {
  limits: { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
  asyncPipelines: false,
}
