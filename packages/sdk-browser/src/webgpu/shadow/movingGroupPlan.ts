import { LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts';
import { SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import {
  GROUP_CAPACITY_WORD,
  GROUP_TABLE_WORDS,
  GROUP_WORDS,
} from '../../gpu/shadow/batchBudget.ts';
import { GROUP_TESTED } from '../../gpu/shadow/groupWgsl.ts';
import { regionTested } from '../pages/render/encodeRegionDraws.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { pagePlan } from './pagePasses.ts';

/** Regions a group holds at least: a sun page restored alone draws in its own viewport, with no
 *  fragment stage, cheaper than a group's pass over the pairs and its fragment test. */
const GROUP_LEAST = 2;

/** The side, in texels, of the blocks of a layer of `texels`: its largest power of two, so that
 *  the two blocks along an axis, at its start and its end, hold every page (`groupWgsl.ts`). */
export const groupBlockSide = (texels: number) => 2 ** Math.floor(Math.log2(texels));

/**
 * WHICH REGIONS OF A BATCH ITS MOVING GROUPS DRAW (#1345), on the host, allocated once: in each
 * pool pass (`pagePlan`), the restored regions of a sun page with casters, keyed by their block
 * word — the block of the layer they lie in, and whether their lists are the occlusion test's —;
 * a key held by at least `GROUP_LEAST` regions is a group. The group table (`words`) names each
 * region's group, then each group's pairs — its regions' lists whole, `capacity` rows each — and
 * block word, then `capacity`.
 */
export function createMovingGroupPlan() {
  const words = new Uint32Array(GROUP_TABLE_WORDS),
    /** Each group's pass, block word and region count. */
    passOf = new Int32Array(MAX_SHADOW_REGIONS),
    bitsOf = new Uint32Array(MAX_SHADOW_REGIONS),
    sizeOf = new Int32Array(MAX_SHADOW_REGIONS),
    /** Per entry of the pass order: its region's block word (`blockWord`). */
    wordOf = new Int32Array(MAX_SHADOW_REGIONS),
    /** Per pass: regions per block word, then the group each block word took. */
    counts = new Int32Array(8),
    owners = new Int32Array(8);

  /** The block word of `region`, a restored page of the pass: −1 unless a sun page with casters. */
  const blockWord = (rt: WebgpuPagesRuntime, region: number, tested: boolean, block: number) => {
    const { regions, plan } = rt.lights,
      slice = plan.pool.slice[regions.pageOf(region)];
    if (regions.casterless(region) || plan.records.kind[slice] !== LIGHT_KIND.directional)
      return -1;
    const right = regions.x(region) + SHADOW_PAGE > block ? 1 : 0,
      bottom = regions.y(region) + SHADOW_PAGE > block ? 2 : 0;
    return right | bottom | (regionTested(region, tested) ? GROUP_TESTED : 0);
  };

  return {
    /** Per region of the batch, its group plus one, 0 for a region no group draws, then the
     *  groups' words. */
    words,
    passOf,
    bitsOf,
    /** Groups the restored sun pages of each pool pass of the batch's `count` regions, whose lists
     *  hold `capacity` rows (`tested`, whether the occlusion test ran). Returns the groups. */
    plan(rt: WebgpuPagesRuntime, count: number, tested: boolean, capacity: number) {
      const block = groupBlockSide(rt.lights.plan.pool.side * SHADOW_PAGE),
        { order, first, clears, restores } = pagePlan;
      let groups = 0;
      words.fill(0, 0, count);
      for (let k = pagePlan.layerPasses; k < pagePlan.passes; k++) {
        const from = first[k] + clears[k],
          to = from + restores[k];
        counts.fill(0);
        owners.fill(-1);
        for (let i = from; i < to; i++) {
          const bits = (wordOf[i] = blockWord(rt, order[i], tested, block));
          if (bits >= 0) counts[bits]++;
        }
        for (let i = from; i < to; i++) {
          const region = order[i],
            bits = wordOf[i];
          if (bits < 0 || counts[bits] < GROUP_LEAST) continue;
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
