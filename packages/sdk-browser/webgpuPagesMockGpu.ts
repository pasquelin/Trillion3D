import type { PackedDag } from './gpuDagSelection.ts';
import {
  createMockCommandEncoderFactory,
  type MockDraw,
  type MockPass,
} from './webgpuPagesMockEncoder.ts';
import { bytesOf } from './webgpuPagesTestGlobals.ts';

export function mockGpu(
  limits: Record<string, number> = { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
  packed?: PackedDag,
  failMap = false,
  rejectR32 = false,
  failVisPass = false,
  enableHiz = false,
  failCompact = false,
) {
  const draws: MockDraw[] = [],
    writes: Array<{ offset: number; bytes: Uint8Array; label?: string; seq: number }> = [];
  // One counter over writes and submits: a row has to reach the GPU before the image that reads it.
  const buffers: Array<{ label?: string; size: number; data: Uint8Array }> = [],
    submits: number[] = [];
  let seq = 0;
  const textures: Array<{
    format?: string;
    usage?: number;
    depthOrArrayLayers: number;
    views: Array<{ dimension?: string } | undefined>;
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
  const layouts: Array<{ entries: Array<{ binding: number; buffer?: { type?: string } }> }> = [];
  let lostResolve: ((info: { reason: string; message: string }) => void) | undefined;
  const lost = new Promise<{ reason: string; message: string }>((resolve) => {
    lostResolve = resolve;
  });
  const device: { [key: string]: unknown } = {
    limits,
    lost,
    createBuffer: ({ size, usage, label }: { size: number; usage: number; label?: string }) => {
      const data = new Uint8Array(size);
      const buffer = {
        size,
        usage,
        label,
        data,
        destroy() {},
        mapAsync: async () => {
          if (failMap && label !== 'WG explicit capture') throw new Error('MAP_FAILED');
        },
        getMappedRange: () => data.buffer,
        unmap() {},
      };
      buffers.push(buffer);
      return buffer;
    },
    createTexture: ({
      size,
      format,
      usage,
    }: {
      size: { width: number; height: number; depthOrArrayLayers?: number };
      format?: string;
      usage?: number;
    }) => {
      const views: Array<{ dimension?: string } | undefined> = [];
      const tex = {
        width: size.width,
        height: size.height,
        depthOrArrayLayers: size.depthOrArrayLayers ?? 1,
        format,
        usage,
        views,
        destroy() {},
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
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: (desc: {
      entries: Array<{ binding: number; buffer?: { type?: string } }>;
    }) => {
      layouts.push(desc);
      return desc;
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (desc: {
      vertex?: { entryPoint?: string };
      fragment?: { targets?: Array<{ format?: string }> };
    }) => {
      if (rejectR32 && desc.fragment?.targets?.[0]?.format === 'r32uint')
        throw new Error('NO_R32UINT');
      return { entryPoint: desc.vertex?.entryPoint };
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
  if (packed || enableHiz)
    device.createComputePipeline = ({ compute }: { compute: { entryPoint: string } }) => {
      if (failCompact && compute.entryPoint === 'scatterGroups') throw new Error('NO_COMPACT');
      return compute;
    };
  return {
    device: device as unknown as GPUDevice,
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
    lose: (reason = 'destroyed') => lostResolve?.({ reason, message: reason }),
  };
}
