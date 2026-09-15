import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import type { ShadowBudget } from './sceneLightShadowBudget.ts';
import type { createShadowCounts } from './sceneLightShadowCounts.ts';
import type { ShadowRegions } from './sceneLightShadowRegions.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import type { SceneLightStore } from './sceneLightStore.ts';

const CANDIDATES = MAX_SHADOW_SLICES * POINT_FACES;

/**
 * La file d'attente des faces qui ont des pages à refaire, et son admission sous budget.
 *
 * Il n'y a pas de tri : autant de balayages de la liste que de faces retenues, ce qui borne le
 * travail par le plafond de régions et non par le nombre de candidates. Une face refusée garde ses
 * pages et repasse à l'image suivante, avec une priorité montée d'autant d'images d'attente ; rien
 * n'est perdu. Tous les tableaux sont alloués une fois.
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
  let count = 0;
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
    /** Vide la file par priorité décroissante jusqu'au budget, puis rend la main. */
    run(slices: ReturnType<typeof createShadowSliceTable>, store: SceneLightStore, frame: number) {
      let spent = 0;
      const accept = (pages: number) => {
        const cost = budget.estimate(pages);
        // La première région passe toujours : sans elle, une page attendrait indéfiniment sur un
        // appareil dont la moindre page dépasse déjà le budget, et le retard ne serait plus borné.
        if (cost !== null && regions.count > 0 && spent + cost > budget.budgetMs) return false;
        spent += cost ?? 0;
        return true;
      };
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
