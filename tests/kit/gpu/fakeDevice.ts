import { installGpuGlobals } from './globals.ts';

/**
 * The recording `GPUDevice` of unit tests that observe what one module asks of a device without a
 * GPU. Every creation, write, encoded copy and destroy succeeds and is recorded in call order; a
 * test reads the list it observes and ignores the others. The usage and stage constants are installed on each call. A test that
 * runs a whole pages backend, or reads back what a compute pass wrote, uses `mockGpu()`, which
 * executes its encoders.
 */

type Numbers = Float32Array | Float64Array | Int32Array | Uint32Array | Uint16Array | Uint8Array;

/** A buffer as the fake creates it: its descriptor, and a mapped range made on first read. */
export type FakeBuffer = {
  label?: string;
  size: number;
  usage: number;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
};
/** A texture as the fake creates it: its descriptor, a view that carries its format. */
type FakeTexture = GPUTextureDescriptor & {
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
type FakeCopy = {
  from: GPUBuffer;
  fromOffset: number;
  to: GPUBuffer;
  toOffset: number;
  size: number;
};
type LostInfo = { reason: string; message: string };

/** The window of `data` a write sent: `dataOffset` and `size` count elements of `data`. */
export const written = ({ data, dataOffset, size }: FakeWrite) =>
  data.subarray(dataOffset, size === undefined ? undefined : dataOffset + size);

const copyOf = (data: BufferSource): Numbers =>
  data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : (data as Numbers).slice();

/** `limits` is the device's `limits`, absent when not given. */
export function fakeDevice({ limits }: { limits?: Record<string, number> } = {}) {
  installGpuGlobals();
  const buffers: FakeBuffer[] = [],
    textures: FakeTexture[] = [],
    bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [],
    bindGroups: GPUBindGroupDescriptor[] = [],
    writes: FakeWrite[] = [],
    copies: FakeCopy[] = [],
    // Every `destroy` call in order, the device's own included: a resource destroyed twice is twice.
    destroyed: Array<{ label?: string }> = [];
  let lose!: (info: LostInfo) => void;
  let fences = 0;
  const lost = new Promise<LostInfo>((resolve) => (lose = resolve));
  const device = {
    label: '',
    lost,
    ...(limits && { limits }),
    destroy: () => void destroyed.push(device),
    createBuffer({ label, size, usage }: GPUBufferDescriptor) {
      let bytes: ArrayBuffer | undefined;
      const buffer: FakeBuffer = {
        label,
        size,
        usage,
        getMappedRange: () => (bytes ??= new ArrayBuffer(size)),
        unmap() {},
        destroy: () => void destroyed.push(buffer),
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture(descriptor: GPUTextureDescriptor) {
      const texture: FakeTexture = {
        ...descriptor,
        createView: () => ({ format: descriptor.format }),
        destroy: () => void destroyed.push(texture),
      };
      textures.push(texture);
      return texture;
    },
    createSampler: () => ({}),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => (
      bindGroupLayouts.push(descriptor),
      descriptor
    ),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createComputePipeline: ({ compute }: GPUComputePipelineDescriptor) => compute,
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (
      bindGroups.push(descriptor),
      descriptor
    ),
    pushErrorScope() {},
    popErrorScope: async () => null,
    createCommandEncoder: () => ({
      copyBufferToBuffer: (
        from: GPUBuffer,
        fromOffset: number,
        to: GPUBuffer,
        toOffset: number,
        size: number,
      ) => void copies.push({ from, fromOffset, to, toOffset, size }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(
        buffer: GPUBuffer,
        offset: number,
        data: BufferSource,
        dataOffset = 0,
        size?: number,
      ) {
        writes.push({ buffer, offset, data: copyOf(data), dataOffset, size });
      },
      submit() {},
      onSubmittedWorkDone: async () => void fences++,
    },
  };
  return {
    device: device as unknown as GPUDevice,
    buffers,
    textures,
    bindGroupLayouts,
    bindGroups,
    writes,
    copies,
    destroyed,
    /** How many times a caller waited for the queue (`onSubmittedWorkDone`). */
    fences: () => fences,
    /** Settles `device.lost` with `info`, as a driver reset or a `destroy` would. */
    lose,
  };
}
