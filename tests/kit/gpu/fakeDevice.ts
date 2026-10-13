import { bytesOf, installGpuGlobals } from './globals.ts'
import {
  copyOf,
  windowOf,
  type FakeDeviceOptions,
  type FakeTexture,
  type FakeTextureWrite,
  type FakeWrite,
} from './fakeRecords.ts'
import { bundleMaker } from './fakeBundles.ts'
import { asWebgpuDevice } from './fakeWebgpuDevice.ts'
import { refusing, texture } from './fakeResources.ts'
import { fakeBuffers } from './mockBuffers.ts'
import { createMockCommandEncoderFactory, type EncoderRecords } from './mockEncoder.ts'
import '../../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'

export {
  BACKEND,
  dispatchedEntries,
  replayWrites,
  written,
  writtenBytes,
  type FakeBuffer,
  type FakeDeviceOptions,
  type FakeWrite,
} from './fakeRecords.ts'

/**
 * THE GPU DEVICE OF THE TESTS, in Node, as WebGPU writes one (`asWebgpuDevice`: an event target,
 * error scopes, loss, `this` checks, WebGPU's validation). Every creation, write, encoded command,
 * render bundle and destroy succeeds and is recorded in call order — a test reads the list it
 * observes —; the buffers hold their bytes, copies and clears move them, and each compute
 * dispatch runs its kernel's CPU double (`mockCompute.ts`), so a whole pages backend runs on it.
 * Options (`FakeDeviceOptions`): limits, features, allocations or mappings that fail, no compute,
 * pipelines built at the call alone, the DAG the selection reads, and the injected failures.
 */
export function fakeDevice(options: FakeDeviceOptions = {}) {
  const { limits, compute = true, asyncPipelines = true, features = [] } = options
  installGpuGlobals()
  const scopes: Array<object | null> = [],
    // Every `destroy` call in order, the device's own included: a resource destroyed twice is twice.
    destroyed: Array<{ label?: string }> = [],
    allocate = refusing(options.refuse, scopes)
  const { buffers, createBuffer, destroyedMaps } = fakeBuffers(destroyed, options)
  const textures: FakeTexture[] = [],
    querySets: GPUQuerySetDescriptor[] = [],
    bindGroupLayouts: GPUBindGroupLayoutDescriptor[] = [],
    pipelineLayouts: GPUPipelineLayoutDescriptor[] = [],
    bindGroups: GPUBindGroupDescriptor[] = [],
    renderPipelines: GPURenderPipelineDescriptor[] = [],
    computePipelines: GPUComputePipelineDescriptor[] = [],
    bundles = bundleMaker(),
    writes: FakeWrite[] = [],
    textureWrites: FakeTextureWrite[] = [],
    imageCopies: GPUCopyExternalImageDestInfo[] = [],
    // The queue's writes and submits share one count: a row reaches the GPU before the image that
    // reads it.
    submits: number[] = []
  const records: EncoderRecords = {
    draws: [],
    passes: [],
    computePasses: [],
    passDescriptors: [],
    commands: [],
    dispatches: [],
    copies: [],
    textureCopies: [],
    textureBufferCopies: [],
    resolves: [],
  }
  let seq = 0,
    fences = 0
  // A pipeline's `getBindGroupLayout`: the layout its group `i` reads. Not enumerable, so a pipeline
  // compares to its descriptor as it was made.
  const withGroups = <P extends object>(pipeline: P, layout: GPUPipelineLayout | 'auto') =>
    Object.defineProperty(pipeline, 'getBindGroupLayout', {
      value: groupLayout(layout),
      writable: true,
      configurable: true,
    })
  const groupLayout = (layout: GPUPipelineLayout | 'auto') => (i: number) =>
    [...((layout as Partial<GPUPipelineLayoutDescriptor>)?.bindGroupLayouts ?? [])][i] ?? {}
  // A render pipeline is its descriptor: a pass that sets it reads its entry points and blend.
  const renderPipeline = (descriptor: GPURenderPipelineDescriptor) => {
    const target = [...(descriptor.fragment?.targets ?? [])][0]
    if (options.rejectR32 && target?.format === 'r32uint') throw new Error('NO_R32UINT')
    const made = withGroups({ ...descriptor }, descriptor.layout)
    renderPipelines.push(made)
    return made
  }
  // A compute pipeline is its stage and its layout: a pass checks the groups it sets against it.
  const computePipeline = (descriptor: GPUComputePipelineDescriptor) => {
    computePipelines.push(descriptor)
    if (options.failCompact && descriptor.compute.entryPoint === 'scatterGroups')
      throw new Error('NO_COMPACT')
    return withGroups({ ...descriptor.compute, layout: descriptor.layout }, descriptor.layout)
  }
  const members: Record<string, unknown> = {
    label: '',
    features: new Set<string>(features),
    ...(limits && { limits }),
    destroy: () => void destroyed.push(device),
    createBuffer: (descriptor: GPUBufferDescriptor) => (
      allocate(descriptor),
      createBuffer(descriptor)
    ),
    createTexture(descriptor: GPUTextureDescriptor) {
      allocate(descriptor)
      const made = texture(descriptor, destroyed)
      textures.push(made)
      return made
    },
    createQuerySet(descriptor: GPUQuerySetDescriptor) {
      querySets.push(descriptor)
      const set = { ...descriptor, destroy: () => void destroyed.push(set) }
      return set
    },
    createSampler: () => ({}),
    createShaderModule: ({ label }: GPUShaderModuleDescriptor) => ({
      label,
      getCompilationInfo: async () => ({
        messages: options.failCompile ? [{ type: 'error' as const, message: 'fail' }] : [],
      }),
    }),
    createBindGroupLayout: (d: GPUBindGroupLayoutDescriptor) => (bindGroupLayouts.push(d), d),
    createPipelineLayout: (d: GPUPipelineLayoutDescriptor) => (pipelineLayouts.push(d), d),
    createRenderPipeline: renderPipeline,
    ...(asyncPipelines && {
      createRenderPipelineAsync: async (d: GPURenderPipelineDescriptor) => renderPipeline(d),
    }),
    ...(compute && {
      createComputePipeline: computePipeline,
      ...(asyncPipelines && {
        createComputePipelineAsync: async (d: GPUComputePipelineDescriptor) => computePipeline(d),
      }),
    }),
    createBindGroup: (d: GPUBindGroupDescriptor) => (bindGroups.push(d), d),
    createRenderBundleEncoder: bundles.make,
    createCommandEncoder: createMockCommandEncoderFactory(records, options),
    queue: {
      writeBuffer(
        buffer: GPUBuffer,
        offset: number,
        data: BufferSource,
        dataOffset = 0,
        size?: number,
      ) {
        writes.push({
          buffer,
          offset,
          data: windowOf(data, dataOffset, size),
          dataOffset,
          size,
          seq: seq++,
        })
        ;(buffer as { data?: Uint8Array } | undefined)?.data?.set(
          bytesOf(data, dataOffset, size),
          offset,
        )
      },
      writeTexture(
        destination: GPUTexelCopyTextureInfo,
        data: BufferSource,
        layout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D,
      ) {
        textureWrites.push({ destination, data: copyOf(data), layout, size, seq: seq++ })
      },
      copyExternalImageToTexture: (_source: unknown, destination: GPUCopyExternalImageDestInfo) =>
        void imageCopies.push(destination),
      submit: () => void submits.push(seq++),
      onSubmittedWorkDone: async () => void fences++,
    },
  }
  const made = asWebgpuDevice(members, scopes)
  const device = made.device
  return {
    ...made,
    ...records,
    buffers,
    textures,
    querySets,
    bindGroupLayouts,
    pipelineLayouts,
    bindGroups,
    renderPipelines,
    computePipelines,
    bundles: bundles.made,
    writes,
    textureWrites,
    imageCopies,
    submits,
    destroyed,
    /** Mappings refused because their buffer was destroyed (`OperationError`). */
    destroyedMaps,
    /** How many times a caller waited for the queue (`onSubmittedWorkDone`). */
    fences: () => fences,
  }
}
