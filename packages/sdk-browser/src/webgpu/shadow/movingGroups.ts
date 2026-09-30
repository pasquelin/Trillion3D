import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import {
  GROUP_CAPACITY_WORD,
  GROUP_TABLE_WORDS,
  GROUP_WORDS,
  SHADOW_REGION_INDIRECT_BYTES,
} from '../../gpu/shadow/batchBudget.ts';
import { shadowBatchWrites } from '../../gpu/shadow/batchWrites.ts';
import { SHADOW_GROUP_PAIRS_WGSL } from '../../gpu/shadow/groupWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { shadowPageGroup } from './freshGroups.ts';
import { createMovingGroupPlan } from './movingGroupPlan.ts';
import { createMovingGroupDraws } from './movingGroupDraws.ts';

const READ: GPUBufferBindingType = 'read-only-storage',
  WRITE: GPUBufferBindingType = 'storage';

/**
 * THE MOVING CASTERS OF A BATCH'S RESTORED PAGES, GROUPED IN INSTANCED DRAWS (#1345). A moving
 * caster restores and redraws each page it lands in; one draw a page cost a draw call and its state
 * per page, 250 a frame for 35 turning antennas. The restored pages of one pass with lists of one
 * kind — the cull's, or all the occlusion test's —, in one block of its layer, are one group
 * (`groupWgsl.ts`; sun pages alone, a lamp page draws in its own viewport): after the cull and the
 * occlusion test, one workgroup per region files its kept places into its group's pairs and counts
 * them into its group's two commands; each pass then draws a group's opaque casters, and its cutout
 * ones, in one indirect draw each, and the transmittance layer's pass its blended ones
 * (`drawBlend`), instead of one each a page. A sun page draws the texels its own viewport drew, to the bit. A lamp page, and
 * a batch with no group or without what a group binds, keeps a draw a page (`drawRegionCasters`).
 */
export async function createShadowMovingGroups(device: GPUDevice) {
  const module = await createCheckedShaderModule(
    device,
    SHADOW_GROUP_PAIRS_WGSL,
    'SHADOW_GROUP_PAIRS',
  );
  const layout = device.createBindGroupLayout({
    entries: [READ, READ, READ, WRITE, WRITE].map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pairsPass = device.createComputePipeline({
    label: 'Trillion3D shadow moving group pairs v1',
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'shadowGroupPairs' },
  });
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const table = device.createBuffer({
    label: 'Trillion3D shadow moving group table v1',
    size: GROUP_TABLE_WORDS * 4,
    usage: storage,
  });
  const args = device.createBuffer({
    label: 'Trillion3D shadow moving group commands v1',
    size: MAX_SHADOW_REGIONS * SHADOW_REGION_INDIRECT_BYTES,
    usage: storage | GPUBufferUsage.INDIRECT,
  });
  const grouping = createMovingGroupPlan(),
    { words, passOf, bitsOf } = grouping;
  let groups = 0,
    pairs: GPUBuffer | undefined,
    bound: {
      indirect?: GPUBuffer;
      visibleIndirect?: GPUBuffer;
      pairs?: GPUBuffer;
      kept?: GPUBuffer;
      visible?: GPUBuffer;
    } = {},
    pairGroup: GPUBindGroup | undefined;
  const draws = createMovingGroupDraws(device, {
    ...{ table, args, passOf, bitsOf },
    groups: () => groups,
    pairs: () => pairs,
  });

  return {
    /** Non-zero for a region of the batch its group draws: `drawRegionCasters` skips it. */
    grouped: words,
    /**
     * Groups the batch's `count` regions (`tested`, whether the occlusion test ran) and files their
     * pairs, after the cull and the occlusion test. Returns the groups made: none, nothing encoded.
     */
    encode(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, count: number, tested: boolean) {
      const { cull, occlusion } = rt.lights;
      // A region skipped by its own draws is drawn by its group: none without what the group binds.
      if (!cull || !count || !shadowPageGroup(rt, device)) return (groups = 0);
      const capacity = Math.floor(cull.kept.size / (MAX_SHADOW_REGIONS * 4));
      groups = grouping.plan(rt, count, tested, capacity);
      if (!groups) return 0;
      if (!pairs || pairs.size < cull.kept.size) {
        pairs?.destroy();
        pairs = device.createBuffer({
          label: 'Trillion3D shadow moving group pairs v1',
          size: cull.kept.size,
          usage: GPUBufferUsage.STORAGE,
        });
      }
      const visible = occlusion?.visibleIndirect ?? cull.indirect;
      if (
        bound.indirect !== cull.indirect ||
        bound.visibleIndirect !== visible ||
        bound.pairs !== pairs ||
        bound.kept !== cull.kept ||
        bound.visible !== occlusion?.visible
      ) {
        bound = {
          indirect: cull.indirect,
          visibleIndirect: visible,
          pairs,
          kept: cull.kept,
          visible: occlusion?.visible,
        };
        pairGroup = undefined;
        draws.forget();
      }
      pairGroup ??= device.createBindGroup({
        layout,
        entries: [table, cull.indirect, visible, args, pairs].map((buffer, binding) => ({
          binding,
          resource: { buffer },
        })),
      });
      const writes = shadowBatchWrites(device);
      writes.write(table, 0, words, 0, count);
      writes.write(table, MAX_SHADOW_REGIONS * 4, words, MAX_SHADOW_REGIONS, groups * GROUP_WORDS);
      writes.write(table, GROUP_CAPACITY_WORD * 4, words, GROUP_CAPACITY_WORD, 1);
      encoder.clearBuffer(args, 0, groups * SHADOW_REGION_INDIRECT_BYTES);
      const pass = encoder.beginComputePass({ label: 'Trillion3D shadow moving groups' });
      pass.setPipeline(pairsPass);
      pass.setBindGroup(0, pairGroup);
      pass.dispatchWorkgroups(count);
      pass.end();
      return groups;
    },
    /** Each group of pool pass `k` drawn into its pass, and into the transmittance layer's. */
    draw: draws.draw,
    drawBlend: draws.drawBlend,
    dispose() {
      table.destroy();
      args.destroy();
      pairs?.destroy();
    },
  };
}

export type ShadowMovingGroups = Awaited<ReturnType<typeof createShadowMovingGroups>>;
