import { simulateComputeDispatch } from './mockCompute.ts';

/** The GPU draw's device in Node, running its compute passes (`simulateComputeDispatch`) into
 *  each buffer's `data`: for a test that reads what the compaction wrote. A test that only
 *  records what a module creates or writes uses `fakeDevice()`. */
export function mockDrawDevice() {
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
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
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
      clearBuffer(buffer: { data: Uint8Array }, offset = 0, size?: number) {
        buffer.data.fill(0, offset, size === undefined ? undefined : offset + size);
      },
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
