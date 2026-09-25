import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from '../draw/draw.ts';
import { MAX_SHADOW_REGIONS } from './atlas.ts';
import { SHADOW_CULL_SHADER } from './cullShader.ts';
import { createGpuShadowCullCounts } from './cullCounts.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { createShadowLightCull } from './lightCull.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { CULL_UNIFORM_WORDS } from './batchBudget.ts';

/** Words of a draw-slot uniform: the matrix, the frame, then the slot and its indirection. */
const DRAW_UNIFORM_WORDS = PAGE_BIND_ALIGN / 4;
const WORD_DRAW_SLOT = 20,
  WORD_INDIRECT = 21;
/** Words of one indirect command. */
const COMMAND_WORDS = DRAW_INDIRECT_STRIDE / 4;

/**
 * The cull's single bind table: its order names both the layout and the group — spheres, source
 * list, source indirect, kept, produced indirect, per-face uniform, volumes, row mobility.
 */
const BINDING_TYPES: readonly GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'uniform',
  'read-only-storage',
  'read-only-storage',
];

/** Where the CPU cut left one run's casters, and which regions read them. */
export interface ShadowCullSource {
  spheres: GPUBuffer;
  /** One word per row: 1 for a moving placement's. */
  mobility: GPUBuffer;
  /** Instance list, page-table rows, from word `base`. */
  source: GPUBuffer;
  base: number;
  /** Its length, as `commands` indirect commands from word `indirectBase` of `indirect`. */
  indirect: GPUBuffer;
  indirectBase: number;
  commands: number;
}

export type GpuShadowCull = Awaited<ReturnType<typeof createGpuShadowCull>>;

/**
 * Per-region cull: one instance list per redrawn region, and the matching indirect command. All
 * buffers are allocated once for a batch — at most `MAX_SHADOW_REGIONS` regions, at most
 * `capacity` clusters each — and a frame, whatever its batches, allocates nothing.
 */
export async function createGpuShadowCull(device: GPUDevice, capacity: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const kept = device.createBuffer({
    label: 'Trillion3D shadow kept clusters v1',
    size: Math.max(4, MAX_SHADOW_REGIONS * capacity * 4),
    usage: GPUBufferUsage.STORAGE,
  });
  const indirect = device.createBuffer({
    label: 'Trillion3D shadow indirect v1',
    size: MAX_SHADOW_REGIONS * DRAW_INDIRECT_STRIDE,
    // `COPY_SRC` for the periodic sample of the kept counts, a diagnostic outside the pass.
    usage: GPUBufferUsage.INDIRECT | storage | GPUBufferUsage.COPY_SRC,
  });
  const faceVolumes = device.createBuffer({
    label: 'Trillion3D shadow face volumes v1',
    size: MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS * 4,
    // A storage array for the CPU lists' cull, a uniform for the light cut's (`lightCull.ts`).
    usage: storage | GPUBufferUsage.UNIFORM,
  });
  // One uniform per face run, at a dynamic offset: a frame writes them all before it submits.
  const uniforms = device.createBuffer({
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const offsets = device.createBuffer({ size: MAX_SHADOW_REGIONS * 4, usage: storage });
  const drawUniform = device.createBuffer({
    label: 'Trillion3D shadow draw slots v1',
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const counts = createGpuShadowCullCounts(device);
  const all = [kept, indirect, faceVolumes, uniforms, offsets, drawUniform];
  let light: Awaited<ReturnType<typeof createShadowLightCull>> | undefined;
  const release = () => {
    for (const buffer of all) buffer.destroy();
    counts.dispose();
    light?.dispose();
  };
  try {
    // Each region's place in the shared list, and its draw slot: set once.
    const offsetWords = new Uint32Array(MAX_SHADOW_REGIONS);
    const drawWords = new Uint32Array(MAX_SHADOW_REGIONS * DRAW_UNIFORM_WORDS);
    for (let region = 0; region < MAX_SHADOW_REGIONS; region++) {
      offsetWords[region] = region * capacity;
      drawWords[region * DRAW_UNIFORM_WORDS + WORD_DRAW_SLOT] = region;
      drawWords[region * DRAW_UNIFORM_WORDS + WORD_INDIRECT] = 1;
    }
    device.queue.writeBuffer(offsets, 0, offsetWords);
    device.queue.writeBuffer(drawUniform, 0, drawWords);
    const module = await createCheckedShaderModule(device, SHADOW_CULL_SHADER, 'SHADOW_CULL');
    light = await createShadowLightCull(device, { kept, indirect, faces: faceVolumes, capacity });
    const layout = device.createBindGroupLayout({
      entries: BINDING_TYPES.map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type, hasDynamicOffset: type === 'uniform' },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const scatter = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'shadowCullScatter' },
    });
    const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS),
      volumeWords = new Uint32Array(volumes.buffer);
    const commands = new Uint32Array(MAX_SHADOW_REGIONS * COMMAND_WORDS);
    const uniData = new Uint32Array(CULL_UNIFORM_WORDS);
    let bound: GPUBuffer[] = [],
      group: GPUBindGroup | undefined;
    return {
      capacity,
      kept,
      indirect,
      offsets,
      drawUniform,
      volumes,
      /** The same volumes as words: which casters each region keeps (`CASTERS_*`). */
      volumeWords,
      /** Periodic sample of what the region culls kept, read after submission. */
      counts,
      /** Opens a batch of `regions` regions: their volumes, and their commands at zero instances —
       *  two writes, never one per region, landing before the batch's commands run. */
      begin(regions: number, maxVertexCount: number) {
        if (!regions) return;
        shadowBatchWrites(device).write(faceVolumes, 0, volumes, 0, regions * SHADOW_CULL_FLOATS);
        commands.fill(0, 0, regions * COMMAND_WORDS);
        for (let region = 0; region < regions; region++)
          commands[region * COMMAND_WORDS] = maxVertexCount;
        shadowBatchWrites(device).write(indirect, 0, commands, 0, regions * COMMAND_WORDS);
      },
      /**
       * Encodes the cull of regions `[first, first + faces)` against the list the CPU cut wrote for
       * one face. `run` is the face's rank in the frame, its uniform slot; `rows` bounds the
       * list, whose true length the GPU reads in its commands.
       */
      encode(
        encoder: GPUCommandEncoder,
        from: ShadowCullSource,
        run: number,
        first: number,
        faces: number,
        rows: number,
      ) {
        if (!faces) return;
        // Group buffers, in bind order. The group is rebuilt only if one of them has changed
        // identity: the GPU cut and the CPU cut each hand the same two every frame.
        if (
          !group ||
          bound[0] !== from.spheres ||
          bound[1] !== from.source ||
          bound[2] !== from.indirect ||
          bound[7] !== from.mobility
        ) {
          const buffers = [from.spheres, from.source, from.indirect];
          buffers.push(kept, indirect, uniforms, faceVolumes, from.mobility);
          bound = buffers;
          group = device.createBindGroup({
            layout,
            entries: buffers.map((buffer, binding) => ({
              binding,
              resource: binding === 5 ? { buffer, size: CULL_UNIFORM_WORDS * 4 } : { buffer },
            })),
          });
        }
        uniData[0] = first;
        uniData[1] = faces;
        uniData[2] = from.base;
        uniData[3] = from.indirectBase;
        uniData[4] = from.commands;
        uniData[5] = capacity;
        shadowBatchWrites(device).write(uniforms, run * PAGE_BIND_ALIGN, uniData);
        const pass = encoder.beginComputePass({ label: 'Trillion3D shadow cull' });
        pass.setBindGroup(0, group, [run * PAGE_BIND_ALIGN]);
        pass.setPipeline(scatter);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(Math.min(rows, capacity) / 64)), faces);
        pass.end();
      },
      /** The GPU light cut's cull: every region of the frame in one pass (`lightCull.ts`). */
      encodeLight: light.encode,
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
