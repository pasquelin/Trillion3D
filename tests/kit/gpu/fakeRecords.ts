/** What `fakeDevice()` records and the options it takes, apart so the device stays readable. */

export type Numbers =
  Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

/** A buffer as the fake creates it: its descriptor, and a mapped range made on first read. */
export type FakeBuffer = {
  label?: string;
  size: number;
  usage: number;
  mapAsync(): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
};
/** A texture as the fake creates it: its descriptor, a view that carries its format. */
export type FakeTexture = GPUTextureDescriptor & {
  createView(): { format: GPUTextureFormat };
  destroy(): void;
};
/** One `queue.writeBuffer`: `data` is a copy taken at the call, an `ArrayBuffer` as bytes. */
export type FakeWrite = {
  buffer: GPUBuffer;
  offset: number;
  data: Numbers;
  dataOffset: number;
  size?: number;
};
/** One `copyBufferToBuffer` an encoder recorded, in the order it was encoded. */
export type FakeCopy = {
  from: GPUBuffer;
  fromOffset: number;
  to: GPUBuffer;
  toOffset: number;
  size: number;
};
/** One `copyTextureToTexture` an encoder recorded, in the order it was encoded. */
export type FakeTextureCopy = {
  from: GPUTexelCopyTextureInfo;
  to: GPUTexelCopyTextureInfo;
  size: GPUExtent3D;
};
export type LostInfo = { reason: string; message: string };

/** The window of `data` a write sent: `dataOffset` and `size` count elements of `data`. */
export const written = ({ data, dataOffset, size }: FakeWrite) =>
  data.subarray(dataOffset, size === undefined ? undefined : dataOffset + size);

export const copyOf = (data: BufferSource): Numbers =>
  data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : (data as Numbers).slice();

/** A buffer or texture creation `refuse` is asked about, and how it fails: `'throw'` throws
 *  `NO_MEMORY` at the call; `'oom'` returns the resource and leaves an out-of-memory error in the
 *  innermost error scope open, as a driver does. */
type Refusal = 'throw' | 'oom' | undefined;
export type FakeDeviceOptions = {
  /** The device's `limits`, absent when not given. */
  limits?: Record<string, number>;
  refuse?: (descriptor: GPUBufferDescriptor | GPUTextureDescriptor) => Refusal;
  /** `false`: the device has no compute pipelines, as a device without compute. */
  compute?: boolean;
  /** Every buffer's `mapAsync` settles when this does; at once when not given. */
  mapping?: Promise<void>;
};
