import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import {
  GROUP_CAPACITY_WORD,
  GROUP_TABLE_WORDS,
  GROUP_WORDS,
} from '../../gpu/shadow/batchBudget.ts';
import { GROUP_LAYER, GROUP_TESTED } from '../../gpu/shadow/groupWgsl.ts';
import { regionTested } from '../pages/render/encodeRegionDraws.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { pagePlan } from './pagePasses.ts';

/** The side, in texels, of the blocks of a layer of `texels`: its largest power of two, so that
 *  the two blocks along an axis, at its start and its end, hold every page (`groupWgsl.ts`). */
export const groupBlockSide = (texels: number) => 2 ** Math.floor(Math.log2(texels));

/**
 * WHICH REGIONS OF A BATCH ITS MOVING GROUPS DRAW (#1345), on the host, allocated once: in each
 * pool pass (`pagePlan`), every restored region with casters, keyed by its block word — a sun
 * page's block of the layer, a lamp page's whole layer (`GROUP_LAYER`), and whether its lists are
 * the occlusion test's —; each key held is a group, as the reference engine draws every page of a light in
 * batched draws: no restored page takes a draw of its own, but a lamp's on a device that cannot
 * clip a caster to its page (`clipsLampGroups`). The group table (`words`) names each
 * region's group, then each group's pairs — its regions' lists whole, `capacity` rows each — and
 * block word, then `capacity`.
 */
export function createMovingGroupPlan() {
  const words = new Uint32Array(GROUP_TABLE_WORDS),
    /** Each group's pass, block word and region count. */
    passOf = new Int32Array(MAX_SHADOW_REGIONS),
    bitsOf = new Uint32Array(MAX_SHADOW_REGIONS),
    sizeOf = new Int32Array(MAX_SHADOW_REGIONS),
    /** Per pass: the group each block word took. */
    owners = new Int32Array(2 * GROUP_LAYER);

  /** The block word of `region`, a restored page of the pass: −1 for a page with no caster, or a
   *  lamp's where the device cannot clip its casters to it (`lamps`). */
  const blockWord = (rt: WebgpuPagesRuntime, region: number, tested: boolean, block: number) => {
    const { regions, plan, shadows } = rt.lights,
      slice = plan.pool.slice[regions.pageOf(region)];
    if (regions.casterless(region)) return -1;
    const lists = regionTested(region, tested) ? GROUP_TESTED : 0;
    if (plan.records.kind[slice] !== LIGHT_KIND.directional)
      return shadows?.groupDraws.lamps ? GROUP_LAYER | lists : -1;
    const right = regions.x(region) + SHADOW_PAGE > block ? 1 : 0,
      bottom = regions.y(region) + SHADOW_PAGE > block ? 2 : 0;
    return right | bottom | lists;
  };

  return {
    /** Per region of the batch, its group plus one, 0 for a region no group draws, then the
     *  groups' words. */
    words,
    passOf,
    bitsOf,
    /** Groups the restored pages of each pool pass of the batch's `count` regions, whose lists
     *  hold `capacity` rows (`tested`, whether the occlusion test ran). Returns the groups. */
    plan(rt: WebgpuPagesRuntime, count: number, tested: boolean, capacity: number) {
      const block = groupBlockSide(rt.lights.plan.pool.side * SHADOW_PAGE),
        { order, first, clears, restores } = pagePlan;
      let groups = 0;
      words.fill(0, 0, count);
      for (let k = pagePlan.layerPasses; k < pagePlan.passes; k++) {
        const from = first[k] + clears[k],
          to = from + restores[k];
        owners.fill(-1);
        for (let i = from; i < to; i++) {
          const region = order[i],
            bits = blockWord(rt, region, tested, block);
          if (bits < 0) continue;
          if (owners[bits] < 0) {
            owners[bits] = groups;
            passOf[groups] = k;
            bitsOf[groups] = bits;
            sizeOf[groups++] = 0;
          }
          sizeOf[owners[bits]]++;
          words[region] = owners[bits] + 1;
        }
      }
      // Each group holds its regions' lists whole: its opaque pairs up, its cutout ones down.
      for (let g = 0, start = 0; g < groups; g++) {
        const head = MAX_SHADOW_REGIONS + g * GROUP_WORDS;
        words[head] = start;
        words[head + 1] = start += sizeOf[g] * capacity;
        words[head + 2] = bitsOf[g];
      }
      words[GROUP_CAPACITY_WORD] = capacity;
      return groups;
    },
  };
}
