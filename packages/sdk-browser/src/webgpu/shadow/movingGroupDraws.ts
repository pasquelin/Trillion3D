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
/** The sides of a group's draws: its opaque casters, its cutout ones (their command is the second
 *  of the group's), then its blended ones into the transmittance layer, depth only, colour only. */
const OPAQUE = 0,
  CUTOUT = 1,
  DEPTH = 2,
  COLOUR = 3;

/** What the draws read of the groups a batch made (`movingGroups.ts`): the group table and the
 *  commands, each group's pass and block word, how many groups, and their pairs. */
export type MovingGroupsHeld = {
  table: GPUBuffer;
  args: GPUBuffer;
  passOf: Int32Array;
  bitsOf: Uint32Array;
  groups: number;
  pairs: GPUBuffer | undefined;
};

/**
 * THE DRAWS OF A BATCH'S MOVING GROUPS (#1345), into a pool pass and into the transmittance
 * layer's: each group in its block's viewport — its layer's for a lamp (`GROUP_LAYER`), each
 * caster clipped to its page by distances (`SHADOW_GROUP_LAMP_WGSL`) —, side by side (`OPAQUE` to
 * `COLOUR`), a pipeline set when it changes. Group 2 is made once per list kind, and per pool
 * layer for the blended casters, until what it binds changes (`forget`, the one way they go).
 */
export function createMovingGroupDraws(device: GPUDevice, held: MovingGroupsHeld) {
  /** Group 2 of the draws by list kind, then of the blended ones by pool layer and kind. */
  let drawGroups: Array<GPUBindGroup | undefined> = [],
    blendGroups: Array<GPUBindGroup | undefined> = [],
    targets: readonly GPUTextureView[] | undefined;
  const forget = () => {
    drawGroups = [];
    blendGroups = [];
  };

  /** Group 2's buffers for lists of kind `lists`, from binding 4 (`groupDraws.ts`). */
  const groupEntries = (rt: WebgpuPagesRuntime, lists: number) =>
    [
      rt.lights.shadows!.faceUniform,
      held.table,
      held.pairs!,
      lists ? rt.lights.occlusion!.visible : rt.lights.cull!.kept,
    ].map((buffer, k) => ({ binding: 4 + k, resource: k ? { buffer } : { buffer, size: FACES } }));

  /** Group 2 of side `side`'s draws of lists of kind `lists`, into pool layer `at`. */
  function groupOf(rt: WebgpuPagesRuntime, side: number, lists: number, at: number) {
    const { groupDraws, targets: views } = rt.lights.shadows!;
    if (side < DEPTH)
      return (drawGroups[lists] ??= device.createBindGroup({
        layout: groupDraws.layout,
        entries: groupEntries(rt, lists),
      }));
    return (blendGroups[2 * at + lists] ??= device.createBindGroup({
      layout: groupDraws.blendLayout,
      entries: [{ binding: 0, resource: views[at] }, ...groupEntries(rt, lists)],
    }));
  }

  /** The pipeline of side `side` of a sun's group, or a lamp's (`lamp`). */
  function pipelineOf(rt: WebgpuPagesRuntime, side: number, lamp: boolean) {
    const { groupDraws } = rt.lights.shadows!;
    if (side === OPAQUE) return groupDraws.made(lamp).opaque;
    if (side === CUTOUT) return groupDraws.made(lamp).cutout;
    return groupDraws.blended(lamp)[side - DEPTH];
  }

  /**
   * Draws side `side` of each group of pool pass `k` into `pass`, in its block's viewport or its
   * layer's, `scale` a texel of the pass (2 in the transmittance layer, whose pool layer is `at`).
   * `first`, whether nothing was drawn into it yet: groups 0 and 1 are bound then. Returns the draws.
   */
  function drawSide(
    rt: WebgpuPagesRuntime,
    pass: GPURenderPassEncoder,
    k: number,
    side: number,
    at: number,
    first: boolean,
  ) {
    const { passOf, bitsOf } = held,
      scale = side < DEPTH ? 1 : 2,
      texels = rt.lights.plan.pool.side * SHADOW_PAGE,
      offset = side === CUTOUT ? DRAW_INDIRECT_STRIDE : 0;
    let drawn = 0,
      bound: GPURenderPipeline | undefined;
    for (let g = 0; g < held.groups; g++) {
      if (passOf[g] !== k) continue;
      const bits = bitsOf[g],
        block = bits & GROUP_LAYER ? texels : groupBlockSide(texels),
        x = (bits & 1 ? texels - block : 0) / scale,
        y = (bits & 2 ? texels - block : 0) / scale,
        pipeline = pipelineOf(rt, side, !!(bits & GROUP_LAYER));
      pass.setViewport(x, y, block / scale, block / scale, 0, 1);
      pass.setScissorRect(x, y, block / scale, block / scale);
      if (first && !drawn) {
        pass.setBindGroup(0, shadowPageGroup(rt, device)!);
        pass.setBindGroup(1, rt.lights.shadows!.faceGroup, [0]);
      }
      if (pipeline !== bound) pass.setPipeline((bound = pipeline));
      pass.setBindGroup(2, groupOf(rt, side, bits & GROUP_TESTED ? 1 : 0, at));
      pass.drawIndirect(held.args, g * SHADOW_REGION_INDIRECT_BYTES + offset);
      drawn++;
    }
    return drawn;
  }

  /** Whether the batch's groups can be drawn: groups made, and what they bind held. */
  const drawable = (rt: WebgpuPagesRuntime) =>
    !!held.groups &&
    !!rt.lights.shadows &&
    !!rt.lights.cull &&
    !!held.pairs &&
    !!shadowPageGroup(rt, device);

  return {
    forget,
    /** Draws into `pass`, pool pass `k` of the batch, each of its groups' opaque casters, then
     *  their cutout ones while any row is a cutout. Returns the draws. */
    draw(rt: WebgpuPagesRuntime, pass: GPURenderPassEncoder, k: number) {
      if (!drawable(rt)) return 0;
      const drawn = drawSide(rt, pass, k, OPAQUE, 0, true);
      return rt.lights.mobility.hasCutouts
        ? drawn + drawSide(rt, pass, k, CUTOUT, 0, !drawn)
        : drawn;
    },
    /** Draws into `pass`, the transmittance layer's pass of pool pass `k`, whose pool layer is
     *  `at`, each of its groups' blended casters, depth only then colour only, against that
     *  layer's depth, as `drawRegionCasters` draws a page's. Returns the draws. */
    drawBlend(rt: WebgpuPagesRuntime, pass: GPURenderPassEncoder, k: number, at: number) {
      if (!drawable(rt)) return 0;
      // The pool's layers were made again: every group 2 they bound goes.
      if (targets !== rt.lights.shadows!.targets) {
        forget();
        targets = rt.lights.shadows!.targets;
      }
      const drawn = drawSide(rt, pass, k, DEPTH, at, true);
      return drawn + drawSide(rt, pass, k, COLOUR, at, !drawn);
    },
  };
}
