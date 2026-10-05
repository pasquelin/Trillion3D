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

import { checkGroup, checkLayout, checkPipelineLayout } from './bindRules.ts';

export { replayWrites, written, type FakeBuffer, type FakeWrite } from './fakeRecords.ts';

/**
 * The recording `GPUDevice` of unit tests that observe what one module asks of a device without a
 * GPU. Every creation, write, encoded copy and destroy succeeds and is recorded in call order; a
 * test reads the list it observes and ignores the others. The usage and stage constants are
 * installed on each call; a pipeline layout past the device's binding limits is refused
 * (`bindRules.ts`). Options inject what a test needs of the device: `limits`, `features`,
 * allocations that fail (`refuse`), no compute pipelines (`compute: false`), and readback mappings
 * that settle when the test says (`mapping`). A test that runs a whole pages backend, or reads back what a
 * compute pass wrote, uses `mockGpu()`, which executes its encoders.
 */
export function fakeDevice({
  limits,
  refuse,
  compute = true,
  mapping,
  features = [],
}: FakeDeviceOptions = {}) {
  installGpuGlobals();
  const buffers: FakeBuffer[] = [],
    textures: FakeTexture[] = [],
    bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [],
    bindGroups: GPUBindGroupDescriptor[] = [],
    renderPipelines: GPURenderPipelineDescriptor[] = [],
    writes: FakeWrite[] = [],
    copies: FakeCopy[] = [],
    textureCopies: FakeTextureCopy[] = [],
    textureWrites: GPUTexelCopyTextureInfo[] = [],
    // Each texture write with its bytes, layout and extent, for a test that replays them.
    texelWrites: {
      destination: GPUTexelCopyTextureInfo;
      data: ReturnType<typeof copyOf>;
      layout: GPUTexelCopyBufferLayout;
      size: GPUExtent3D;
    }[] = [],
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
  // A compute pipeline is its stage and its layout: a pass checks the groups it sets against it.
  const computePipeline = (d: GPUComputePipelineDescriptor) => ({ ...d.compute, layout: d.layout });
  const device = {
    label: '',
    lost,
    features: new Set(features),
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
      const size = descriptor.size;
      const [width, height = 1, depthOrArrayLayers = 1] =
        'width' in size ? [size.width, size.height, size.depthOrArrayLayers] : [...size];
      const texture: FakeTexture = {
        ...descriptor,
        width,
        height,
        depthOrArrayLayers,
        mipLevelCount: descriptor.mipLevelCount ?? 1,
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
      checkLayout(descriptor),
      bindGroupLayouts.push(descriptor),
      descriptor
    ),
    createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => (checkPipelineLayout(d, limits), d),
    createRenderPipeline: renderPipeline,
    createRenderPipelineAsync: async (descriptor: GPURenderPipelineDescriptor) =>
      renderPipeline(descriptor),
    ...(compute && {
      createComputePipeline: computePipeline,
      createComputePipelineAsync: async (descriptor: GPUComputePipelineDescriptor) =>
        computePipeline(descriptor),
    }),
    createBindGroup: (d: GPUBindGroupDescriptor) => (checkGroup(d), bindGroups.push(d), d),
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
      writeTexture: (
        destination: GPUTexelCopyTextureInfo,
        data: BufferSource,
        layout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      ) => {
        textureWrites.push(destination);
        texelWrites.push({ destination, data: copyOf(data), layout, size });
      },
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
    writes,
    copies,
    textureCopies,
    textureWrites,
    texelWrites,
    imageCopies,
    destroyed,
    scopes,
    /** How many times a caller waited for the queue (`onSubmittedWorkDone`). */
    fences: () => fences,
    /** Settles `device.lost` with `info`, as a driver reset or a `destroy` would. */
    lose,
  };
}
