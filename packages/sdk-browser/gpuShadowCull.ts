import { SHADOW_CULL_FLOATS } from '../sdk-core/src/index.ts';
import { DRAW_INDIRECT_STRIDE, PAGE_BIND_ALIGN } from './gpuDraw.ts';
import { MAX_SHADOW_REGIONS } from './gpuShadowAtlas.ts';
import { SHADOW_CULL_SHADER } from './gpuShadowCullShader.ts';
import { createGpuShadowCullCounts } from './gpuShadowCullCounts.ts';
import { createCheckedShaderModule } from './gpuShaderModule.ts';

/** Words of a draw-slot uniform: the matrix, the frame, then the slot and its indirection. */
const DRAW_UNIFORM_WORDS = PAGE_BIND_ALIGN / 4;
const WORD_DRAW_SLOT = 20,
  WORD_INDIRECT = 21;

/**
 * The cull's single bind table: its order names both the layout and the group — spheres, source
 * list, source indirect, kept, produced indirect, uniform, volumes, live.
 */
const BINDING_TYPES: readonly GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'uniform',
  'read-only-storage',
  'storage',
];

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
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const faceVolumes = device.createBuffer({
    label: 'WG shadow face volumes v1',
    size: MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS * 4,
    usage: storage,
  });
  const uniforms = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const live = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
  const offsets = device.createBuffer({ size: MAX_SHADOW_REGIONS * 4, usage: storage });
  const drawUniform = device.createBuffer({
    label: 'WG shadow draw slots v1',
    size: MAX_SHADOW_REGIONS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const counts = createGpuShadowCullCounts(device);
  const all = [kept, indirect, faceVolumes, uniforms, live, offsets, drawUniform];
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
        buffer: { type },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const prepare = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'shadowCullPrepare' },
    });
    const scatter = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'shadowCullScatter' },
    });
    const volumes = new Float32Array(MAX_SHADOW_REGIONS * SHADOW_CULL_FLOATS);
    const uniData = new Uint32Array(4);
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
      /** Pushes the volumes of the first `faces` faces: one write, never one per face. */
      flushVolumes(faces: number) {
        if (faces) device.queue.writeBuffer(faceVolumes, 0, volumes, 0, faces * SHADOW_CULL_FLOATS);
      },
      /**
       * Encodes the cull of every face of the frame. `slots` is the command count of the main
       * compact, `rows` the upper bound of instances it may have produced, and `maxVertexCount`
       * the vertex count an instance draws.
       */
      encode(
        encoder: GPUCommandEncoder,
        sources: { spheres: GPUBuffer; source: GPUBuffer; sourceIndirect: GPUBuffer },
        faces: number,
        slots: number,
        rows: number,
        maxVertexCount: number,
      ) {
        if (!faces) return;
        // Group buffers, in bind order: the frame's first, ours next. The group is rebuilt
        // only if one of them has changed identity.
        const buffers = [
          sources.spheres,
          sources.source,
          sources.sourceIndirect,
          kept,
          indirect,
          uniforms,
          faceVolumes,
          live,
        ];
        if (!group || buffers.some((buffer, index) => bound[index] !== buffer)) {
          bound = buffers;
          group = device.createBindGroup({
            layout,
            entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
          });
        }
        uniData[0] = faces;
        uniData[1] = slots;
        uniData[2] = maxVertexCount;
        uniData[3] = capacity;
        device.queue.writeBuffer(uniforms, 0, uniData);
        const pass = encoder.beginComputePass({ label: 'WG shadow cull' });
        pass.setBindGroup(0, group);
        pass.setPipeline(prepare);
        pass.dispatchWorkgroups(1);
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
