import { MAX_SHADOW_SLICES, POINT_FACES } from '../light/contracts.ts';
import type { ShadowBudget } from './budget.ts';
import type { createShadowCounts } from './counts.ts';
import type { ShadowRegions } from './regions.ts';
import type { createShadowSliceTable } from './slices.ts';
import type { SceneLightStore } from '../light/store.ts';

const CANDIDATES = MAX_SHADOW_SLICES * POINT_FACES;

/**
 * Queue of faces that have pages to remake, and its admission under budget.
 *
 * There is no sort: as many scans of the list as faces kept, which bounds the
 * work by the region ceiling and not by the number of candidates. A refused face keeps its
 * pages and comes back next frame, with a priority raised by as many waiting frames; nothing
 * is lost. All arrays are allocated once.
 */
export function createShadowAdmission(
  regions: ShadowRegions,
  budget: ShadowBudget,
  counts: ReturnType<typeof createShadowCounts>,
) {
  const light = new Int32Array(CANDIDATES),
    slice = new Int32Array(CANDIDATES),
    face = new Int32Array(CANDIDATES),
    rows = new Int32Array(CANDIDATES),
    priority = new Float64Array(CANDIDATES);
  let count = 0,
    spent = 0;
  /** Price of a region against what remains of the budget; set once, not once per frame. */
  const accept = (pages: number) => {
    const cost = budget.estimate(pages);
    // The first region always passes: without it, a page would wait forever on a
    // device whose smallest page already exceeds the budget, and lag would no longer be bounded.
    if (cost !== null && regions.count > 0 && spent + cost > budget.budgetMs) return false;
    spent += cost ?? 0;
    return true;
  };
  return {
    reset() {
      count = 0;
    },
    add(slot: number, sliceIndex: number, faceIndex: number, pageRows: number, value: number) {
      if (count >= CANDIDATES) return;
      light[count] = slot;
      slice[count] = sliceIndex;
      face[count] = faceIndex;
      rows[count] = pageRows;
      priority[count] = value;
      count++;
    },
    /** Empties the queue by decreasing priority until the budget, then yields. */
    run(slices: ReturnType<typeof createShadowSliceTable>, store: SceneLightStore, frame: number) {
      spent = 0;
      for (let picked = 0; picked < count && regions.count < regions.capacity; picked++) {
        let best = -1,
          bestPriority = -Infinity;
        for (let index = 0; index < count; index++)
          if (priority[index] > bestPriority) {
            bestPriority = priority[index];
            best = index;
          }
        if (best < 0) break;
        priority[best] = -Infinity;
        const before = regions.count;
        const complete = regions.addFace(
          slices.dirty,
          light[best],
          slice[best],
          face[best],
          rows[best],
          accept,
        );
        if (regions.count > before) {
          slices.markDrawn(slice[best]);
          counts.drewLight(light[best], store, frame);
        }
        if (!complete) break;
      }
      count = 0;
    },
  };
}
