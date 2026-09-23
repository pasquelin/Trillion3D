import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from '../draw/draw.ts';
import { MAX_SHADOW_REGIONS } from './atlas.ts';
import { SHADOW_CULL_SHADER } from './cullShader.ts';
import { createGpuShadowCullCounts } from './cullCounts.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';

/** Words of a draw-slot uniform: the matrix, the frame, then the slot and its indirection. */
const DRAW_UNIFORM_WORDS = PAGE_BIND_ALIGN / 4;
const WORD_DRAW_SLOT = 20,
  WORD_INDIRECT = 21;
/** Words of one indirect command, and of one face's cull uniform. */
const COMMAND_WORDS = DRAW_INDIRECT_STRIDE / 4,
  CULL_UNIFORM_WORDS = 8;

/**
 * The cull's single bind table: its order names both the layout and the group — spheres, source
 * list, source indirect, kept, produced indirect, per-face uniform, volumes.
 */
const BINDING_TYPES: readonly GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'uniform',
  'read-only-storage',
];

/** Where one redrawn face's light cut left its casters, and which regions read them. */
export interface ShadowCullSource {
  spheres: GPUBuffer;
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
 * buffers are allocated once for a frame's budget — at most `MAX_SHADOW_REGIONS` regions, at
 * most `capacity` clusters each — and a frame allocates nothing.
 */
export async function createGpuShadowCull(device: GPUDevice, capacity: number) {
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const kept = device.createBuffer({
    label: 'WG shadow kept clusters v1',
    size: Math.max(4, MAX_SHADOW_REGIONS * capacity * 4),
    usage: GPUBufferUsage.STORAGE,
  });
  const indirect = device.createBuffer({
    label: 'WG shadow indirect v1',
    size: MAX_SHADOW_REGIONS * DRAW_INDIRECT_STRIDE,
    // `COPY_SRC` for the periodic sample of the kept counts, a diagnostic outside the pass.
    usage: GPUBufferUsage.INDIRECT | storage | GPUBufferUsage.COPY_SRC,
  });
  const faceVolumes = device.createBuffer({
    label: 'WG shadow face volumes v1',
    size: MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS * 4,
    usage: storage,
  });
  // One uniform per face run, at a dynamic offset: a frame writes them all before it submits.
  const uniforms = device.createBuffer({
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const offsets = device.createBuffer({ size: MAX_SHADOW_REGIONS * 4, usage: storage });
  const drawUniform = device.createBuffer({
    label: 'WG shadow draw slots v1',
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const counts = createGpuShadowCullCounts(device);
  const all = [kept, indirect, faceVolumes, uniforms, offsets, drawUniform];
  const release = () => {
    for (const buffer of all) buffer.destroy();
    counts.dispose();
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
    const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
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
      /** Periodic sample of what the region culls kept, read after submission. */
      counts,
      /**
       * Opens a frame of `regions` regions: their volumes, and their commands at zero instances.
       * Two writes, never one per region, landing before the command buffer runs.
       */
      begin(regions: number, maxVertexCount: number) {
        if (!regions) return;
        device.queue.writeBuffer(faceVolumes, 0, volumes, 0, regions * SHADOW_CULL_FLOATS);
        commands.fill(0, 0, regions * COMMAND_WORDS);
        for (let region = 0; region < regions; region++)
          commands[region * COMMAND_WORDS] = maxVertexCount;
        device.queue.writeBuffer(indirect, 0, commands, 0, regions * COMMAND_WORDS);
      },
      /**
       * Encodes the cull of regions `[first, first + faces)` against the list one face's light
       * cut produced. `run` is the face's rank in the frame, its uniform slot; `rows` bounds the
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
          bound[2] !== from.indirect
        ) {
          const buffers = [from.spheres, from.source, from.indirect];
          buffers.push(kept, indirect, uniforms, faceVolumes);
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
        device.queue.writeBuffer(uniforms, run * PAGE_BIND_ALIGN, uniData);
        const pass = encoder.beginComputePass({ label: 'WG shadow cull' });
        pass.setBindGroup(0, group, [run * PAGE_BIND_ALIGN]);
        pass.setPipeline(scatter);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil(Math.min(rows, capacity) / 64)), faces);
        pass.end();
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}
