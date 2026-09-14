import { simulateComputeDispatch } from '../../packages/sdk-browser/webgpuPagesMockCompute.ts';

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
          simulateComputeDispatch(pipeline, bind, []);
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
