import { DRAW_INDIRECT_WORDS } from '../draw/contract.ts';
import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { oncePerDevice } from '../core/oncePerDevice.ts';
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { createGpuShadowCullCounts } from './cullCounts.ts';
import { emptyRegionCommands } from './cull.ts';
import { HIZ_UNTESTED, SHADOW_OCCLUSION_SHADER } from './occlusionShader.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import {
  OCCLUSION_SLOT_WORDS,
  OCCLUSION_UNIFORM_WORDS,
  SHADOW_REGION_COMMANDS,
  SHADOW_REGION_INDIRECT_BYTES,
} from './batchBudget.ts';

const BINDINGS: readonly GPUBufferBindingType[] = [
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'uniform',
];

/** What the occlusion test reads, frame to frame: the cull's lists and the page pyramids. */
export interface ShadowOcclusionInputs {
  spheres: GPUBuffer;
  kept: GPUBuffer;
  indirect: GPUBuffer;
  views: GPUBuffer;
  pyramid: GPUBuffer;
}

/** The occlusion test's layout and pipeline, compiled once a device: at prepare
 *  (`../../webgpu/pages/prepare/lights.ts`), never at the first move that makes the test. */
export const shadowOcclusionPipeline = oncePerDevice(async (device) => {
  const module = await createCheckedShaderModule(
    device,
    SHADOW_OCCLUSION_SHADER,
    'SHADOW_OCCLUSION',
  );
  const layout = device.createBindGroupLayout({
    entries: BINDINGS.map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pipeline = await buildComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'shadowHizTest' },
  });
  return { layout, pipeline };
});

/**
 * The moving casters of each tested region, less those the static layer hides from the light
 * (`occlusionShader.ts`): two visible lists and their indirect commands per region, the same shape
 * as the cull's, which the region then draws instead. Hidden counts are sampled one frame in fifteen,
 * as the cull's are. Allocated once for a batch.
 */
export async function createShadowOcclusion(device: GPUDevice, capacity: number) {
  const { layout, pipeline } = await shadowOcclusionPipeline(device);
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const visible = device.createBuffer({
      label: 'Trillion3D shadow visible casters v1',
      size: Math.max(4, MAX_SHADOW_REGIONS * capacity * 4),
      usage: GPUBufferUsage.STORAGE,
    }),
    visibleIndirect = device.createBuffer({
      label: 'Trillion3D shadow visible indirect v1',
      size: MAX_SHADOW_REGIONS * SHADOW_REGION_INDIRECT_BYTES,
      usage: GPUBufferUsage.INDIRECT | storage,
    }),
    slots = device.createBuffer({
      label: 'Trillion3D shadow page pyramid slots v1',
      size: MAX_SHADOW_REGIONS * OCCLUSION_SLOT_WORDS * 4,
      usage: storage | GPUBufferUsage.COPY_SRC,
    }),
    uniform = device.createBuffer({
      size: OCCLUSION_UNIFORM_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  const counts = createGpuShadowCullCounts(device);
  const slotWords = new Uint32Array(MAX_SHADOW_REGIONS * OCCLUSION_SLOT_WORDS),
    commands = new Uint32Array(MAX_SHADOW_REGIONS * SHADOW_REGION_COMMANDS * DRAW_INDIRECT_WORDS),
    uni = new Uint32Array(OCCLUSION_UNIFORM_WORDS);
  let bound: GPUBuffer[] = [],
    group: GPUBindGroup | undefined;
  return {
    visible,
    visibleIndirect,
    /** Hidden casters of the last sampled frame, all tested regions together. */
    counts,
    /**
     * Tests the regions `slot(r)` names a pyramid for — the others are left untested —, over the
     * `regions` first regions, whose lists hold at most `rows` casters.
     */
    encode(
      encoder: GPUCommandEncoder,
      from: ShadowOcclusionInputs,
      regions: number,
      slot: (region: number) => number,
      rows: number,
      maxVertexCount: number,
      frame: number,
    ) {
      const inputs = [from.spheres, from.kept, from.indirect, from.views, from.pyramid];
      if (!group || inputs.some((buffer, i) => bound[i] !== buffer)) {
        bound = inputs;
        const buffers = [from.spheres, from.kept, from.indirect, visible, visibleIndirect];
        buffers.push(from.views, from.pyramid, slots, uniform);
        group = device.createBindGroup({
          layout,
          entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
        });
      }
      for (let r = 0; r < regions; r++) {
        slotWords[r * OCCLUSION_SLOT_WORDS] = slot(r);
        slotWords[r * OCCLUSION_SLOT_WORDS + 1] = 0;
      }
      const words = emptyRegionCommands(commands, regions, maxVertexCount);
      shadowBatchWrites(device).write(slots, 0, slotWords, 0, regions * OCCLUSION_SLOT_WORDS);
      shadowBatchWrites(device).write(visibleIndirect, 0, commands, 0, words);
      uni[0] = regions;
      uni[1] = capacity;
      shadowBatchWrites(device).write(uniform, 0, uni);
      const pass = encoder.beginComputePass({ label: 'Trillion3D shadow occlusion' });
      pass.setBindGroup(0, group);
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(Math.max(1, Math.ceil(Math.min(rows, capacity) / 64)), regions);
      pass.end();
      counts.sample(encoder, slots, regions, frame);
    },
    dispose() {
      for (const buffer of [visible, visibleIndirect, slots, uniform]) buffer.destroy();
      counts.dispose();
    },
  };
}

export type ShadowOcclusion = Awaited<ReturnType<typeof createShadowOcclusion>>;
export { HIZ_UNTESTED };
