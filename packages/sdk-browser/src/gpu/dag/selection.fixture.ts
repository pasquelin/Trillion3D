import { evaluateDagSelectionKernel, type PackedDag } from './selection.ts';
import { bytesOf, compactDrawnPages } from '../../../../../tests/kit/gpu/globals.ts';
import { SELECTION_HEADER_WORDS, residentBase, residentBit } from './layout.ts';

export function mockDagDevice(
  packed: PackedDag,
  options: { failMap?: boolean; mapGate?: Promise<void> } = {},
) {
  type Buf = { size: number; usage: number; data: Uint8Array };
  let bind: { entries: Array<{ binding: number; resource: { buffer: Buf } }> } | undefined;
  let pipeline: { entryPoint: string } | undefined,
    uniformWriteCount = 0,
    copyCount = 0;
  const readUniforms = (data: Uint8Array) => {
    const f32 = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const u32 = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    return {
      uniforms: {
        planes: f32.slice(0, 24),
        view: f32.slice(24, 40),
        pixelScale: [f32[40], f32[41]] as [number, number],
        pixelError: f32[42],
        near: f32[43],
        cameraWorld: [f32[48], f32[49], f32[50]] as [number, number, number],
        cameraStretch: f32[51],
      },
      residentCut: !!u32[47],
    };
  };
  const device = {
    limits: { maxBufferSize: 1 << 20, maxStorageBufferBindingSize: 1 << 20 },
    createBuffer: ({ size, usage }: { size: number; usage: number }) => ({
      size,
      usage,
      data: new Uint8Array(size),
      destroy() {},
      mapAsync: async function (this: Buf) {
        if (options.failMap) throw new Error('MAP_FAILED');
        await options.mapGate;
      },
      getMappedRange: function (this: Buf) {
        return this.data.buffer;
      },
      unmap() {},
    }),
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipeline: ({ compute }: { compute: { entryPoint: string } }) => compute,
    createBindGroup: (desc: typeof bind) => {
      if (!desc || desc.entries.length !== 9)
        throw new Error('dag selection bind group requires 9 entries');
      bind = desc;
      return desc;
    },
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline(next: { entryPoint: string }) {
          pipeline = next;
        },
        setBindGroup(_i: number, group: typeof bind) {
          bind = group;
        },
        // The five kernels that follow `dagWanted` dispatch over the live-cluster list: the GPU
        // sizes that dispatch, and the double replays the same kernel whichever path launched it.
        dispatchWorkgroupsIndirect(this: { dispatchWorkgroups(): void }) {
          this.dispatchWorkgroups();
        },
        dispatchWorkgroups() {
          // The whole kernel is replayed once, on its last stage; the earlier stages still have to run.
          const stage = pipeline?.entryPoint;
          if ((stage !== 'dagMask' && stage !== 'dagDrawScatter') || !bind) return;
          const byBinding = new Map(
            bind.entries.map((entry) => [entry.binding, entry.resource.buffer]),
          );
          // Compaction rereads draw flags, like the three kernels it replaces.
          if (stage === 'dagDrawScatter') {
            compactDrawnPages(
              byBinding.get(3)!.data,
              byBinding.get(4)!.data,
              packed.nodeCount,
              packed.pageCount,
            );
            return;
          }
          const { uniforms, residentCut } = readUniforms(byBinding.get(2)!.data);
          // Residency lives as bits behind the cold records: the double rereads it through the
          // shared decoder, like the shader, rather than at a rank copied here.
          const bits = new Uint32Array(
            packed.pageCones.buffer,
            packed.pageCones.byteOffset,
            packed.pageCones.length,
          );
          const base = residentBase(packed.pageCount);
          const resident = residentCut
            ? Uint32Array.from({ length: packed.pageCount }, (_, id) =>
                residentBit(bits, base, id) ? 1 : 0,
              )
            : undefined;
          const result = evaluateDagSelectionKernel(packed, uniforms, resident);
          const out = byBinding.get(4)!.data;
          const ints = new Uint32Array(out.buffer, out.byteOffset, out.byteLength / 4);
          ints.fill(0);
          ints[0] = result.pageIds.length;
          ints[1] = result.frustumRejected;
          ints[2] = result.lodLevel;
          ints[3] = result.complete === false ? 2 : 0;
          ints.set(result.pageIds, SELECTION_HEADER_WORDS);
          const flags = new Uint32Array(byBinding.get(3)!.data.buffer);
          flags.fill(0, packed.nodeCount);
          for (const id of result.drawablePageIds ?? []) flags[packed.nodeCount + id] = 1;
        },
        end() {},
      }),
      copyBufferToBuffer(src: Buf, s: number, dst: Buf, d: number, size: number) {
        // Arming copies go to the dispatch argument; only the one that targets a readable slot
        // is the snapshot, and it alone is what a frame pays in GPU latency.
        if (dst.usage & 1) copyCount++;
        dst.data.set(src.data.subarray(s, s + size), d);
      },
      finish: () => ({}),
    }),
    queue: {
      // The written slice is the one the caller names: residency no longer sends every cone but
      // a contiguous range, described by `dataOffset` and `size` as WebGPU does.
      writeBuffer(
        buffer: Buf,
        offset: number,
        data: BufferSource,
        dataOffset?: number,
        size?: number,
      ) {
        buffer.data.set(bytesOf(data, dataOffset, size), offset);
        if (buffer.size === 256) uniformWriteCount++;
      },
      submit() {},
      onSubmittedWorkDone: async () => {},
    },
  };
  return {
    device: device as unknown as GPUDevice,
    uniformWrites: () => uniformWriteCount,
    /** Copies to a READABLE slot: one per due readback, never one per send. */
    readbackCopies: () => copyCount,
  };
}
