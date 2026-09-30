import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import {
  GROUP_CAPACITY_WORD,
  GROUP_TABLE_WORDS,
  GROUP_WORDS,
  SHADOW_FACE_STRIDE,
  SHADOW_REGION_INDIRECT_BYTES,
} from '../../gpu/shadow/batchBudget.ts';
import { shadowBatchWrites } from '../../gpu/shadow/batchWrites.ts';
import { GROUP_TESTED, SHADOW_GROUP_PAIRS_WGSL } from '../../gpu/shadow/groupWgsl.ts';
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts';
import { DRAW_INDIRECT_STRIDE } from '../../gpu/draw/contract.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { shadowPageGroup } from './freshGroups.ts';
import { createMovingGroupPlan, groupBlockSide } from './movingGroupPlan.ts';

const READ = 'read-only-storage',
  WRITE = 'storage';
/** Bytes of the faces the groups read: every region's, before the pass order (`pageQuads.ts`). */
const FACES = MAX_SHADOW_REGIONS * SHADOW_FACE_STRIDE;

/**
 * THE MOVING CASTERS OF A BATCH'S SUN PAGES, GROUPED IN INSTANCED DRAWS (#1345). A moving caster
 * restores and redraws each page it lands in; one draw a page cost a draw call and its state per
 * page, 250 a frame for 35 turning antennas. The restored sun pages of one pass, in one block of
 * its layer, with lists of one kind — the cull's, or all the occlusion test's — are one group
 * (`groupWgsl.ts`): after the cull and the occlusion test, one workgroup per region files its kept
 * places into its group's pairs and counts them into its group's two commands; each pass then draws
 * a group's opaque casters, and its cutout ones, in one indirect draw each, instead of one each a
 * page. A page draws the texels its own viewport drew, to the bit. Lamp pages, a region alone in
 * its group, and a batch with no group keep a draw each (`drawRegionCasters`).
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
    { words, grouped, passOf, bitsOf } = grouping;
  let groups = 0,
    pairs: GPUBuffer | undefined,
    bound: unknown[] = [],
    pairGroup: GPUBindGroup | undefined,
    drawGroups: [GPUBindGroup | undefined, GPUBindGroup | undefined] = [undefined, undefined];

  return {
    /** 1 for a region of the batch its group draws: `drawRegionCasters` skips it. */
    grouped,
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
      const visible = occlusion?.visibleIndirect ?? cull.indirect,
        key = [cull.indirect, visible, pairs, cull.kept, occlusion?.visible];
      if (key.some((part, k) => part !== bound[k])) {
        bound = key;
        pairGroup = undefined;
        drawGroups = [undefined, undefined];
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
    /**
     * Draws into `pass`, pool pass `k` of the batch, each of its groups: in its block's viewport,
     * its opaque casters, then its cutout ones while any row is a cutout. Returns the draws.
     */
    draw(rt: WebgpuPagesRuntime, pass: GPURenderPassEncoder, k: number) {
      const { shadows, cull, occlusion, mobility } = rt.lights,
        pageGroup = shadowPageGroup(rt, device);
      if (!groups || !shadows || !cull || !pairs || !pageGroup) return 0;
      const draws = shadows.groupDraws.made(),
        texels = rt.lights.plan.pool.side * SHADOW_PAGE,
        block = groupBlockSide(texels);
      let drawn = 0;
      for (let g = 0; g < groups; g++) {
        if (passOf[g] !== k) continue;
        const bits = bitsOf[g],
          x = bits & 1 ? texels - block : 0,
          y = bits & 2 ? texels - block : 0,
          lists = bits & GROUP_TESTED ? 1 : 0;
        const group = (drawGroups[lists] ??= device.createBindGroup({
          layout: shadows.groupDraws.layout,
          entries: [
            { binding: 4, resource: { buffer: shadows.faceUniform, size: FACES } },
            { binding: 5, resource: { buffer: table } },
            { binding: 6, resource: { buffer: pairs } },
            { binding: 7, resource: { buffer: lists ? occlusion!.visible : cull.kept } },
          ],
        }));
        pass.setViewport(x, y, block, block, 0, 1);
        pass.setScissorRect(x, y, block, block);
        pass.setBindGroup(0, pageGroup);
        pass.setBindGroup(1, shadows.faceGroup, [0]);
        pass.setBindGroup(2, group);
        pass.setPipeline(draws.opaque);
        pass.drawIndirect(args, g * SHADOW_REGION_INDIRECT_BYTES);
        drawn++;
        if (!mobility.hasCutouts) continue;
        pass.setPipeline(draws.cutout);
        pass.drawIndirect(args, g * SHADOW_REGION_INDIRECT_BYTES + DRAW_INDIRECT_STRIDE);
        drawn++;
      }
      return drawn;
    },
    dispose() {
      table.destroy();
      args.destroy();
      pairs?.destroy();
    },
  };
}

export type ShadowMovingGroups = Awaited<ReturnType<typeof createShadowMovingGroups>>;
