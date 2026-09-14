import type { DrawItem } from '../../packages/sdk-browser/gpuDraw.ts';
import { evaluateDrawCompact, indirectForDraw } from '../../packages/sdk-browser/gpuDraw.ts';

export function installGpuGlobals() {
  Object.assign(globalThis, {
    GPUBufferUsage: {
      MAP_READ: 1,
      MAP_WRITE: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
      INDEX: 16,
      VERTEX: 32,
      UNIFORM: 64,
      STORAGE: 128,
      INDIRECT: 256,
      QUERY_RESOLVE: 512,
    },
    GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 },
    GPUMapMode: { READ: 1, WRITE: 2 },
  });
}

export function mockDrawDevice(options: { failCompile?: boolean } = {}) {
  const buffers: Array<{ size: number; usage: number; data: Uint8Array }> = [],
    writes: Array<{ offset: number; size: number }> = [];
  let bind:
    | { entries: Array<{ binding: number; resource: { buffer: (typeof buffers)[number] } }> }
    | undefined;
  let pipeline: { entryPoint: string } | undefined;
  const device = {
    limits: { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
    createBuffer: ({ size, usage }: { size: number; usage: number }) => {
      const data = new Uint8Array(size);
      const buffer = { size, usage, data, destroy() {} };
      buffers.push(buffer);
      return buffer;
    },
    createShaderModule: () => ({
      getCompilationInfo: async () => ({
        messages: options.failCompile ? [{ type: 'error' as const, message: 'fail' }] : [],
      }),
    }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipeline: ({ compute }: { compute: { entryPoint: string } }) => compute,
    createBindGroup: (desc: typeof bind) => {
      bind = desc;
      return desc;
    },
    pushErrorScope() {},
    popErrorScope: async () => null,
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline(next: { entryPoint: string }) {
          pipeline = next;
        },
        setBindGroup(_i: number, group: typeof bind) {
          bind = group;
        },
        dispatchWorkgroups() {
          if (pipeline?.entryPoint !== 'scatterGroups' || !bind) return;
          const byBinding = new Map(
            bind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
          );
          const uniBytes = byBinding.get(1)!.data;
          const uni = new Uint32Array(
            uniBytes.buffer,
            uniBytes.byteOffset,
            uniBytes.byteLength / 4,
          );
          const count = uni[0],
            maxVertexCount = uni[1],
            slotCap = uni[2];
          const itemBytes = byBinding.get(0)!.data;
          const itemInts = new Uint32Array(
            itemBytes.buffer,
            itemBytes.byteOffset,
            itemBytes.byteLength / 4,
          );
          const n = Math.min(count, slotCap);
          const restBytes = byBinding.get(7)!.data;
          const restInts = new Uint32Array(
            restBytes.buffer,
            restBytes.byteOffset,
            restBytes.byteLength / 4,
          );
          const items: DrawItem[] = [];
          for (let i = 0; i < n; i++)
            items.push({
              pageIndex: itemInts[i * 4],
              bin: itemInts[i * 4 + 1] as 0 | 1 | 2,
              rest: ((restInts[i >> 5] >> (i & 31)) & 1) as 0 | 1,
            });
          const source =
            count > slotCap
              ? items.concat(
                  Array.from({ length: count - n }, () => ({
                    pageIndex: 0,
                    bin: 0 as const,
                    rest: 0 as const,
                  })),
                )
              : items;
          const result = evaluateDrawCompact(source, maxVertexCount, slotCap);
          const offsets = byBinding.get(5)!.data;
          new Uint32Array(offsets.buffer).set(
            Array.from({ length: 6 }, (_, slot) => result.indirect[slot * 4 + 3]),
          );
          const instBytes = byBinding.get(2)!.data;
          new Uint32Array(instBytes.buffer, instBytes.byteOffset, instBytes.byteLength / 4).set(
            result.instances,
          );
          const indBytes = byBinding.get(3)!.data;
          new Uint32Array(indBytes.buffer, indBytes.byteOffset, indBytes.byteLength / 4).set(
            indirectForDraw(result),
          );
        },
        end() {},
      }),
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(
        buffer: { size: number; data: Uint8Array },
        offset: number,
        data: BufferSource,
        dataOffset = 0,
        size?: number,
      ) {
        const view =
          data instanceof ArrayBuffer
            ? new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset)
            : new Uint8Array(
                (data as ArrayBufferView).buffer,
                (data as ArrayBufferView).byteOffset + dataOffset,
                size ?? (data as ArrayBufferView).byteLength - dataOffset,
              );
        writes.push({ offset, size: view.byteLength });
        buffer.data.set(view, offset);
      },
      submit() {},
    },
  };
  return { device: device as unknown as GPUDevice, buffers, writes };
}
