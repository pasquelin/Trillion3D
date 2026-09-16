import { evaluateDagSelectionKernel, type PackedDag } from './gpuDagSelection.ts';
import { bytesOf, compactDrawnPages } from './webgpuPagesTestGlobals.ts';
import { residentBase, residentBit } from './gpuDagLayout.ts';

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

export function mockDagDevice(
  packed: PackedDag,
  options: { failMap?: boolean; mapGate?: Promise<void> } = {},
) {
  type Buf = { size: number; usage: number; data: Uint8Array };
  let bind: { entries: Array<{ binding: number; resource: { buffer: Buf } }> } | undefined;
  let pipeline: { entryPoint: string } | undefined,
    uniformWriteCount = 0;
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
        // Les cinq noyaux qui suivent `dagWanted` se répartissent sur la liste des grappes vivantes :
        // c'est la carte graphique qui en dimensionne la répartition, et le double rejoue le même
        // noyau quel que soit le chemin par lequel il est lancé.
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
          // La compaction relit les drapeaux de dessin, comme les trois noyaux qu'elle remplace.
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
          // La résidence vit en bits derrière les enregistrements froids : le double la relit par
          // le décodeur partagé, comme le nuanceur, plutôt qu'à un rang recopié ici.
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
          ints.set(result.pageIds, 4);
          const flags = new Uint32Array(byBinding.get(3)!.data.buffer);
          flags.fill(0, packed.nodeCount);
          for (const id of result.drawablePageIds ?? []) flags[packed.nodeCount + id] = 1;
        },
        end() {},
      }),
      copyBufferToBuffer(src: Buf, s: number, dst: Buf, d: number, size: number) {
        dst.data.set(src.data.subarray(s, s + size), d);
      },
      finish: () => ({}),
    }),
    queue: {
      // La tranche écrite est celle que l'appelant nomme : la résidence n'envoie plus tous les cônes
      // mais une plage contiguë, décrite par `dataOffset` et `size` comme le fait WebGPU.
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
  return { device: device as unknown as GPUDevice, uniformWrites: () => uniformWriteCount };
}
