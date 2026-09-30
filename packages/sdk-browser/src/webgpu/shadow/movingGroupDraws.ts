import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { SHADOW_FACE_STRIDE, SHADOW_REGION_INDIRECT_BYTES } from '../../gpu/shadow/batchBudget.ts';
import { GROUP_LAYER, GROUP_TESTED } from '../../gpu/shadow/groupWgsl.ts';
import { DRAW_INDIRECT_STRIDE } from '../../gpu/draw/contract.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { shadowPageGroup } from './freshGroups.ts';
import { groupBlockSide } from './movingGroupPlan.ts';

/** Bytes of the faces the groups read: every region's, before the pass order (`pageQuads.ts`). */
const FACES = MAX_SHADOW_REGIONS * SHADOW_FACE_STRIDE;

/** What the draws read of the groups a batch made (`movingGroups.ts`): the group table and the
 *  commands, each group's pass and block word, how many groups, and their pairs. */
export type MovingGroupsHeld = {
  table: GPUBuffer;
  args: GPUBuffer;
  passOf: Int32Array;
  bitsOf: Uint32Array;
  groups: () => number;
  pairs: () => GPUBuffer | undefined;
};

/**
 * THE DRAWS OF A BATCH'S MOVING GROUPS (#1345), into a pool pass and into the transmittance
 * layer's: each group in its block's viewport — its layer's for a lamp (`GROUP_LAYER`) —, its
 * group 2 made once per list kind, and per pool layer for the blended casters, until what it binds
 * changes (`forget`).
 */
export function createMovingGroupDraws(device: GPUDevice, held: MovingGroupsHeld) {
  const { table, args, passOf, bitsOf } = held;
  /** Group 2 of the draws by list kind, then of the blended ones by pool layer and kind. */
  let drawGroups: Array<GPUBindGroup | undefined> = [],
    blendGroups: Array<GPUBindGroup | undefined> = [],
    targets: readonly GPUTextureView[] | undefined;
  /** Group 2's buffers for lists of kind `lists`, from binding 4 (`groupDraws.ts`). */
  const groupEntries = (rt: WebgpuPagesRuntime, lists: number) =>
    [
      rt.lights.shadows!.faceUniform,
      table,
      held.pairs()!,
      lists ? rt.lights.occlusion!.visible : rt.lights.cull!.kept,
    ].map((buffer, k) => ({ binding: 4 + k, resource: k ? { buffer } : { buffer, size: FACES } }));
  /**
   * Draws into `pass`, pool pass `k` of the batch, each of its groups — `drawList` sets its
   * pipelines and draws —, in its block's viewport or its layer's, `scale` a texel of the pass (2
   * in the transmittance layer), its group 2 `groupOf` its list kind. Returns the draws.
   */
  const drawGroupsOf = (
    rt: WebgpuPagesRuntime,
    pass: GPURenderPassEncoder,
    k: number,
    scale: number,
    groupOf: (lists: number) => GPUBindGroup,
    drawList: (g: number) => number,
  ) => {
    const { shadows } = rt.lights,
      pageGroup = shadowPageGroup(rt, device),
      groups = held.groups();
    if (!groups || !shadows || !rt.lights.cull || !held.pairs() || !pageGroup) return 0;
    const texels = rt.lights.plan.pool.side * SHADOW_PAGE;
    let drawn = 0;
    for (let g = 0; g < groups; g++) {
      if (passOf[g] !== k) continue;
      const bits = bitsOf[g],
        block = bits & GROUP_LAYER ? texels : groupBlockSide(texels),
        x = (bits & 1 ? texels - block : 0) / scale,
        y = (bits & 2 ? texels - block : 0) / scale;
      pass.setViewport(x, y, block / scale, block / scale, 0, 1);
      pass.setScissorRect(x, y, block / scale, block / scale);
      if (!drawn) {
        pass.setBindGroup(0, pageGroup);
        pass.setBindGroup(1, shadows.faceGroup, [0]);
      }
      pass.setBindGroup(2, groupOf(bits & GROUP_TESTED ? 1 : 0));
      drawn += drawList(g);
    }
    return drawn;
  };
  return {
    /** What group 2 binds changed: every one is made again. */
    forget() {
      drawGroups = [];
      blendGroups = [];
    },
    /** Draws into `pass`, pool pass `k` of the batch, each of its groups: its opaque casters,
     *  then its cutout ones while any row is a cutout. Returns the draws. */
    draw(rt: WebgpuPagesRuntime, pass: GPURenderPassEncoder, k: number) {
      const { shadows, mobility } = rt.lights;
      if (!shadows) return 0;
      const draws = shadows.groupDraws.made(),
        layout = shadows.groupDraws.layout;
      const groupOf = (lists: number) =>
        (drawGroups[lists] ??= device.createBindGroup({
          layout,
          entries: groupEntries(rt, lists),
        }));
      return drawGroupsOf(rt, pass, k, 1, groupOf, (g) => {
        pass.setPipeline(draws.opaque);
        pass.drawIndirect(args, g * SHADOW_REGION_INDIRECT_BYTES);
        if (!mobility.hasCutouts) return 1;
        pass.setPipeline(draws.cutout);
        pass.drawIndirect(args, g * SHADOW_REGION_INDIRECT_BYTES + DRAW_INDIRECT_STRIDE);
        return 2;
      });
    },
    /** Draws into `pass`, the transmittance layer's pass of pool pass `k`, whose pool layer is
     *  `at`, each of its groups' blended casters, depth only then colour only, against that
     *  layer's depth, as `drawRegionCasters` draws a page's. Returns the draws. */
    drawBlend(rt: WebgpuPagesRuntime, pass: GPURenderPassEncoder, k: number, at: number) {
      const { shadows } = rt.lights;
      if (!shadows) return 0;
      const draws = shadows.groupDraws.blended(),
        layout = shadows.groupDraws.blendLayout;
      if (targets !== shadows.targets) [targets, blendGroups] = [shadows.targets, []];
      const groupOf = (lists: number) =>
        (blendGroups[2 * at + lists] ??= device.createBindGroup({
          layout,
          entries: [{ binding: 0, resource: shadows.targets[at] }, ...groupEntries(rt, lists)],
        }));
      return drawGroupsOf(rt, pass, k, 2, groupOf, (g) => {
        for (const pipeline of draws) {
          pass.setPipeline(pipeline);
          pass.drawIndirect(args, g * SHADOW_REGION_INDIRECT_BYTES);
        }
        return draws.length;
      });
    },
  };
}
