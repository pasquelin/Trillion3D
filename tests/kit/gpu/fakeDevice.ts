import { installGpuGlobals } from './globals.ts';
import {
  copyOf,
  type FakeBuffer,
  type FakeCopy,
  type FakeDeviceOptions,
  type FakeTexture,
  type FakeTextureCopy,
  type FakeWrite,
  type LostInfo,
} from './fakeRecords.ts';

export { written, type FakeBuffer, type FakeWrite } from './fakeRecords.ts';

/**
 * The recording `GPUDevice` of unit tests that observe what one module asks of a device without a
 * GPU. Every creation, write, encoded copy and destroy succeeds and is recorded in call order; a
 * test reads the list it observes and ignores the others. The usage and stage constants are
 * installed on each call. Options inject what a test needs of the device: `limits`, allocations
 * that fail (`refuse`), no compute pipelines (`compute: false`), and readback mappings that settle
 * when the test says (`mapping`). A test that runs a whole pages backend, or reads back what a
 * compute pass wrote, uses `mockGpu()`, which executes its encoders.
 */
export function fakeDevice({ limits, refuse, compute = true, mapping }: FakeDeviceOptions = {}) {
  installGpuGlobals();
  const buffers: FakeBuffer[] = [],
    textures: FakeTexture[] = [],
    bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [],
    bindGroups: GPUBindGroupDescriptor[] = [],
    renderPipelines: GPURenderPipelineDescriptor[] = [],
    computePipelines: GPUComputePipelineDescriptor[] = [],
    writes: FakeWrite[] = [],
    copies: FakeCopy[] = [],
    textureCopies: FakeTextureCopy[] = [],
    textureWrites: GPUTexelCopyTextureInfo[] = [],
    imageCopies: GPUCopyExternalImageDestInfo[] = [],
    // The error scopes open, innermost last, each with the first error raised under it.
    scopes: Array<object | null> = [],
    // Every `destroy` call in order, the device's own included: a resource destroyed twice is twice.
    destroyed: Array<{ label?: string }> = [];
  let lose!: (info: LostInfo) => void;
  let fences = 0;
  const lost = new Promise<LostInfo>((resolve) => (lose = resolve));
  /** Applies `refuse` to one creation, before its resource is made. */
  const allocate = (descriptor: GPUBufferDescriptor | GPUTextureDescriptor) => {
    const refusal = refuse?.(descriptor);
    if (refusal === 'throw') throw new Error('NO_MEMORY');
    if (refusal !== 'oom') return;
    if (!scopes.length) throw new Error('fakeDevice: out of memory outside an error scope');
    scopes[scopes.length - 1] ??= { message: 'Out of memory' };
  };
  // A render pipeline is its descriptor: a pass that sets it can be read back as it was made.
  const renderPipeline = (descriptor: GPURenderPipelineDescriptor) => (
    renderPipelines.push(descriptor),
    descriptor
  );
  const computePipeline = (descriptor: GPUComputePipelineDescriptor) => (
    computePipelines.push(descriptor),
    descriptor.compute
  );
  const device = {
    label: '',
    lost,
    ...(limits && { limits }),
    destroy: () => void destroyed.push(device),
    createBuffer(descriptor: GPUBufferDescriptor) {
      allocate(descriptor);
      const { label, size, usage } = descriptor;
      let bytes: ArrayBuffer | undefined;
      const buffer: FakeBuffer = {
        label,
        size,
        usage,
        mapAsync: async () => void (await mapping),
        getMappedRange: () => (bytes ??= new ArrayBuffer(size)),
        unmap() {},
        destroy: () => void destroyed.push(buffer),
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture(descriptor: GPUTextureDescriptor) {
      allocate(descriptor);
      const texture: FakeTexture = {
        ...descriptor,
        createView: () => ({ format: descriptor.format }),
        destroy: () => void destroyed.push(texture),
      };
      textures.push(texture);
      return texture;
    },
    createSampler: () => ({}),
    createShaderModule: ({ label }: GPUShaderModuleDescriptor) => ({
      label,
      getCompilationInfo: async () => ({ messages: [] }),
    }),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => (
      bindGroupLayouts.push(descriptor),
      descriptor
    ),
    createPipelineLayout: () => ({}),
    createRenderPipeline: renderPipeline,
    createRenderPipelineAsync: async (descriptor: GPURenderPipelineDescriptor) =>
      renderPipeline(descriptor),
    ...(compute && {
      createComputePipeline: computePipeline,
      createComputePipelineAsync: async (descriptor: GPUComputePipelineDescriptor) =>
        computePipeline(descriptor),
    }),
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => (
      bindGroups.push(descriptor),
      descriptor
    ),
    pushErrorScope: () => void scopes.push(null),
    popErrorScope: async () => {
      if (!scopes.length) throw new DOMException('No error scope to pop', 'OperationError');
      return scopes.pop() ?? null;
    },
    createCommandEncoder: () => ({
      copyBufferToBuffer: (
        from: GPUBuffer,
        fromOffset: number,
        to: GPUBuffer,
        toOffset: number,
        size: number,
      ) => void copies.push({ from, fromOffset, to, toOffset, size }),
      clearBuffer() {},
      copyTextureToTexture: (
        from: GPUTexelCopyTextureInfo,
        to: GPUTexelCopyTextureInfo,
        size: GPUExtent3D,
      ) => void textureCopies.push({ from, to, size }),
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
      writeTexture: (destination: GPUTexelCopyTextureInfo) => void textureWrites.push(destination),
      copyExternalImageToTexture: (_source: unknown, destination: GPUCopyExternalImageDestInfo) =>
        void imageCopies.push(destination),
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
    renderPipelines,
    computePipelines,
    writes,
    copies,
    textureCopies,
    textureWrites,
    imageCopies,
    destroyed,
    scopes,
    /** How many times a caller waited for the queue (`onSubmittedWorkDone`). */
    fences: () => fences,
    /** Settles `device.lost` with `info`, as a driver reset or a `destroy` would. */
    lose,
  };
}
