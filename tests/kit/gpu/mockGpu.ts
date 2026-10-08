import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts'
import { createMockCommandEncoderFactory, type MockDraw, type MockPass } from './mockEncoder.ts'
import { bytesOf, installGpuGlobals } from './globals.ts'
import { mockBuffers, type MapFaults, type MockWrite } from './mockBuffers.ts'
import { asWebgpuDevice, untag } from './fakeWebgpuDevice.ts'
import { fakeBundleEncoder } from './fakeBundles.ts'

/** What a test asks of `mockGpu`: the device limits, the DAG its compute selection runs on — the
 *  one the session uploads when none is given (`mockDag.ts`) —, and the failures it injects. */
export type MockGpuOptions = MapFaults & {
  limits?: Record<string, number>
  packed?: PackedDag
  rejectR32?: boolean
  failVisPass?: boolean
  failCompact?: boolean
  failCompile?: boolean
}

/**
 * The device that executes, in Node: encoders record passes, draws, bundles and copies, compute
 * dispatches run on their kernels' CPU doubles (`mockCompute.ts`), `asWebgpuDevice` adds error
 * scopes, loss, `this` checks and WebGPU's validation (`validation.ts`). A pages backend runs on
 * it; `fakeDevice()` only records.
 */
export function mockGpu({
  limits = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
  packed,
  rejectR32 = false,
  failVisPass = false,
  failCompact = false,
  failCompile = false,
  ...faults
}: MockGpuOptions = {}) {
  installGpuGlobals()
  const draws: MockDraw[] = [],
    writes: MockWrite[] = []
  // One counter over writes and submits: a row has to reach the GPU before the image that reads it.
  const { buffers, createBuffer, destroyedMaps } = mockBuffers(faults),
    submits: number[] = [],
    copyUsages: number[] = []
  let seq = 0
  const textures: Array<{
    label?: string
    width: number
    height: number
    format?: string
    usage?: number
    depthOrArrayLayers: number
    views: Array<{ dimension?: string } | undefined>
    destroyed: boolean
  }> = []
  const passes: MockPass[] = []
  /** Each row strip transferred to an atlas layer, in the order it left. */
  const textureWrites: Array<{
    mipLevel: number
    layer: number
    row: number
    rows: number
    seq: number
  }> = []
  const computes: string[] = [],
    commands: string[] = [],
    imageCopies: unknown[] = []
  const renderPipelines: GPURenderPipelineDescriptor[] = [],
    computePipelines: GPUComputePipelineDescriptor[] = []
  const layouts: Array<{ entries: Array<{ binding: number; buffer?: { type?: string } }> }> = []
  const members: Record<string, unknown> = {
    limits,
    // No block family: every lane pool is RGBA8, as on a software adapter.
    features: new Set<string>(),
    createBuffer: (descriptor: { size: number; usage: number; label?: string }) =>
      createBuffer({ ...descriptor, label: untag(descriptor.label) }),
    createTexture: ({
      label: tagged,
      size,
      format,
      usage,
      mipLevelCount = 1,
    }: GPUTextureDescriptor) => {
      const views: Array<{ dimension?: string } | undefined> = []
      // A GPUExtent3D, as a dictionary or a sequence.
      const [width, height = 1, depthOrArrayLayers = 1] =
        'width' in size ? [size.width, size.height, size.depthOrArrayLayers] : [...size]
      const tex = {
        label: untag(tagged),
        width,
        height,
        depthOrArrayLayers,
        format,
        usage,
        // A GPUTexture's own: a mip chain reads its level count back from the texture.
        mipLevelCount,
        views,
        destroyed: false,
        destroy: () => void (tex.destroyed = true),
        createView(desc?: GPUTextureViewDescriptor) {
          const view = { format, ...desc }
          views.push(view)
          return view
        },
      }
      textures.push(tex)
      return tex
    },
    createSampler: () => ({}),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({
        messages: failCompile ? [{ type: 'error' as const, message: 'fail' }] : [],
      }),
    }),
    createBindGroupLayout: (desc: {
      entries: Array<{ binding: number; buffer?: { type?: string } }>
    }) => {
      layouts.push(desc)
      return desc
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
      renderPipelines.push(desc)
      const target = [...(desc.fragment?.targets ?? [])][0]
      if (rejectR32 && target?.format === 'r32uint') throw new Error('NO_R32UINT')
      const blend = target?.blend
      return {
        entryPoint: desc.vertex?.entryPoint,
        fragment: desc.fragment?.entryPoint,
        blend,
        getBindGroupLayout: () => ({}),
      }
    },
    createComputePipeline: (descriptor: GPUComputePipelineDescriptor) => {
      computePipelines.push(descriptor)
      const stage = descriptor.compute as GPUProgrammableStage & { entryPoint: string }
      if (failCompact && stage.entryPoint === 'scatterGroups') throw new Error('NO_COMPACT')
      return stage
    },
    createBindGroup: (desc: unknown) => desc,
    createRenderBundleEncoder: fakeBundleEncoder,
    createCommandEncoder: createMockCommandEncoderFactory({
      draws,
      passes,
      commands,
      computes,
      imageCopies,
      copyUsages,
      packed,
      failVisPass,
    }),
    queue: {
      writeBuffer(
        buffer: { data?: Uint8Array; label?: string; size?: number },
        offset: number,
        data: BufferSource,
        dataOffset?: number,
        size?: number,
      ) {
        const bytes = bytesOf(data, dataOffset, size)
        const { label, size: target } = buffer
        writes.push({ offset, bytes: new Uint8Array(bytes), label, size: target, seq: seq++ })
        buffer.data?.set(bytes, offset)
      },
      writeTexture(
        destination: { mipLevel?: number; origin?: number[] },
        _data: unknown,
        _layout: unknown,
        size: { width?: number; height?: number },
      ) {
        textureWrites.push({
          mipLevel: destination.mipLevel ?? 0,
          layer: destination.origin?.[2] ?? 0,
          row: destination.origin?.[1] ?? 0,
          rows: size.height ?? 0,
          seq: seq++,
        })
      },
      submit() {
        submits.push(seq++)
      },
      onSubmittedWorkDone: async () => {},
    },
  }
  return {
    ...asWebgpuDevice(members),
    draws,
    writes,
    buffers,
    submits,
    textures,
    passes,
    commands,
    computes,
    layouts,
    imageCopies,
    copyUsages,
    destroyedMaps,
    textureWrites,
    renderPipelines,
    computePipelines,
  }
}
