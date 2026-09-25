import type { PackedDag } from '../../../packages/sdk-browser/src/gpu/dag/selection.ts';
import { createMockCommandEncoderFactory, type MockDraw, type MockPass } from './mockEncoder.ts';
import { bytesOf } from './globals.ts';
import { asWebgpuDevice, untag } from './webgpuDevice.ts';

/** What a test asks of `mockGpu`: the device limits, the DAG its compute selection runs on, and
 *  the failures it injects. `compute` gives the device compute pipelines without a DAG. */
export type MockGpuOptions = {
  limits?: Record<string, number>;
  packed?: PackedDag;
  compute?: boolean;
  failMap?: boolean;
  rejectR32?: boolean;
  failVisPass?: boolean;
  failCompact?: boolean;
  failCompile?: boolean;
};

/**
 * The device that executes, in Node: command encoders record passes, draws and copies, compute
 * dispatches run on the CPU doubles of their kernels (`mockCompute.ts`), and `asWebgpuDevice`
 * gives it WebGPU's error scopes, uncaptured errors, loss and `this` checks. A whole pages
 * backend, or a compute module whose results a test reads back, runs on it. A test that only
 * records what one module creates uses `fakeDevice()` instead.
 */
export function mockGpu({
  limits = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
  packed,
  compute = false,
  failMap = false,
  rejectR32 = false,
  failVisPass = false,
  failCompact = false,
  failCompile = false,
}: MockGpuOptions = {}) {
  const draws: MockDraw[] = [],
    writes: Array<{ offset: number; bytes: Uint8Array; label?: string; seq: number }> = [];
  // One counter over writes and submits: a row has to reach the GPU before the image that reads it.
  const buffers: Array<{ label?: string; size: number; usage: number; data: Uint8Array }> = [],
    submits: number[] = [];
  let seq = 0;
  const textures: Array<{
    label?: string;
    width: number;
    height: number;
    format?: string;
    usage?: number;
    depthOrArrayLayers: number;
    views: Array<{ dimension?: string } | undefined>;
    destroyed: boolean;
  }> = [];
  const passes: MockPass[] = [];
  /** Each row strip transferred to an atlas layer, in the order it left. */
  const textureWrites: Array<{
    mipLevel: number;
    layer: number;
    row: number;
    rows: number;
    seq: number;
  }> = [];
  const computes: string[] = [];
  const imageCopies: unknown[] = [];
  const renderPipelines: GPURenderPipelineDescriptor[] = [];
  const layouts: Array<{ entries: Array<{ binding: number; buffer?: { type?: string } }> }> = [];
  const members: Record<string, unknown> = {
    limits,
    // No block family: every lane pool is RGBA8, as on a software adapter.
    features: new Set<string>(),
    createBuffer: (descriptor: { size: number; usage: number; label?: string }) => {
      const { size, usage } = descriptor,
        label = untag(descriptor.label);
      const data = new Uint8Array(size);
      const buffer = {
        size,
        usage,
        label,
        data,
        destroy() {},
        mapAsync: async () => {
          if (failMap && label !== 'Trillion3D explicit capture') throw new Error('MAP_FAILED');
        },
        getMappedRange: () => data.buffer,
        unmap() {},
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture: ({
      label: tagged,
      size,
      format,
      usage,
    }: {
      label?: string;
      size: { width: number; height: number; depthOrArrayLayers?: number };
      format?: string;
      usage?: number;
    }) => {
      const views: Array<{ dimension?: string } | undefined> = [];
      const tex = {
        label: untag(tagged),
        width: size.width,
        height: size.height,
        depthOrArrayLayers: size.depthOrArrayLayers ?? 1,
        format,
        usage,
        views,
        destroyed: false,
        destroy: () => void (tex.destroyed = true),
        createView(desc?: { dimension?: string }) {
          const view = { format, ...desc };
          views.push(view);
          return view;
        },
      };
      textures.push(tex);
      return tex;
    },
    createSampler: () => ({}),
    createShaderModule: () => ({
      getCompilationInfo: async () => ({
        messages: failCompile ? [{ type: 'error' as const, message: 'fail' }] : [],
      }),
    }),
    createBindGroupLayout: (desc: {
      entries: Array<{ binding: number; buffer?: { type?: string } }>;
    }) => {
      layouts.push(desc);
      return desc;
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (desc: GPURenderPipelineDescriptor) => {
      renderPipelines.push(desc);
      if (rejectR32 && [...(desc.fragment?.targets ?? [])][0]?.format === 'r32uint')
        throw new Error('NO_R32UINT');
      return { entryPoint: desc.vertex?.entryPoint, fragment: desc.fragment?.entryPoint };
    },
    createBindGroup: (desc: unknown) => desc,
    createCommandEncoder: createMockCommandEncoderFactory({
      draws,
      passes,
      computes,
      imageCopies,
      packed,
      failVisPass,
    }),
    queue: {
      writeBuffer(
        buffer: { data?: Uint8Array; label?: string },
        offset: number,
        data: BufferSource,
        dataOffset?: number,
        size?: number,
      ) {
        const bytes = bytesOf(data, dataOffset, size);
        writes.push({ offset, bytes: new Uint8Array(bytes), label: buffer.label, seq: seq++ });
        buffer.data?.set(bytes, offset);
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
        });
      },
      submit() {
        submits.push(seq++);
      },
      onSubmittedWorkDone: async () => {},
    },
  };
  if (packed || compute)
    members.createComputePipeline = ({ compute: stage }: { compute: { entryPoint: string } }) => {
      if (failCompact && stage.entryPoint === 'scatterGroups') throw new Error('NO_COMPACT');
      return stage;
    };
  return {
    ...asWebgpuDevice(members),
    draws,
    writes,
    buffers,
    submits,
    textures,
    passes,
    computes,
    layouts,
    imageCopies,
    textureWrites,
    renderPipelines,
  };
}
