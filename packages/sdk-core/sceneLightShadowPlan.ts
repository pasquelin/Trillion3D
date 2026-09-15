import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { desiredFaceSide } from './sceneLightShadowAtlas.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import { createShadowSliceTable, RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';
import { createShadowChanges } from './sceneLightShadowChanges.ts';
import { createShadowBudget } from './sceneLightShadowBudget.ts';
import { createShadowRegions } from './sceneLightShadowRegions.ts';
import { invalidateLightPages } from './sceneLightShadowInvalidate.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';
import { createShadowCounts, screenCoverage } from './sceneLightShadowCounts.ts';

export type ShadowPlan = ReturnType<typeof createShadowPlan>;
const CANDIDATES = MAX_SHADOW_SLICES * POINT_FACES;

/**
 * L'ordonnanceur d'ombres. Le travail d'une image n'est plus « quatre lampes » mais **les pages
 * périmées les plus prioritaires, jusqu'à un budget en millisecondes** (RX3, X4) : une lampe ou une
 * cascade qui bouge périme sa carte entière, un objet qui bouge ne périme que les pages que sa boîte
 * projetée recouvre, et les pages refusées cette image-ci attendent la suivante — jamais perdues,
 * leur retard publié. Une lampe fixe dans une scène fixe ne coûte toujours rien (X5).
 *
 * Tous les tableaux sont alloués une fois ; `plan()` n'allouera jamais.
 */
export function createShadowPlan(capacity: number) {
  const slices = createShadowSliceTable();
  const changes = createShadowChanges();
  const budget = createShadowBudget();
  const regions = createShadowRegions(capacity);
  const counts = createShadowCounts();
  // L'invalidation par pages peut s'éteindre : la face entière repart alors, comme avant le lot.
  // C'est le seul moyen de comparer les deux règles sur le même moteur, à la même image près.
  let byPage = true;
  const coverage = new Float64Array(LIGHT_SETTINGS.maxLights);
  const candidateLight = new Int32Array(CANDIDATES),
    candidateSlice = new Int32Array(CANDIDATES),
    candidateFace = new Int32Array(CANDIDATES),
    candidateRows = new Int32Array(CANDIDATES),
    candidatePriority = new Float64Array(CANDIDATES);
  const plan = {
    slices,
    regions,
    budget,
    coverage,
    counts,
    /** Un nœud a bougé : sa boîte entre dans la liste que l'ordonnanceur consommera à l'image suivante. */
    worldChanged: changes.worldChanged,
    /** Le chronomètre de la passe Ombres d'une image, rapporté aux pages qu'elle avait redessinées. */
    observeCost: budget.observe,
    setBudgetMs: budget.setBudgetMs,
    /** Éteint l'invalidation par pages : toute face touchée repart entière. Allumée par défaut. */
    setPageInvalidation(on: boolean) {
      byPage = on;
    },
    get pageInvalidation() {
      return byPage;
    },
    /**
     * Choisit les régions de cette image. Rend leur nombre ; `plan.regions` les décrit une à une, et
     * les pages qu'elles couvrent sont déjà retirées de la file d'attente.
     */
    plan(store: SceneLightStore, view: ShadowViewpoint, frame: number, nowMs: number) {
      const { packed } = store;
      regions.reset();
      counts.beginFrame();
      let casters = 0,
        candidates = 0;
      for (let slot = 0; slot < store.count; slot++)
        if (packed[SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS + LIGHT_FIELD.castsShadow])
          casters++;
      for (let slot = 0; slot < store.count; slot++) {
        const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
        let slice = store.sliceOf(slot);
        coverage[slot] = 0;
        if (packed[base + LIGHT_FIELD.castsShadow] === 0) {
          if (slice >= 0) {
            slices.free(slice);
            store.assignSlice(slot, -1);
          }
          continue;
        }
        const kind = packed[base + LIGHT_FIELD.kind];
        const sun = kind === LIGHT_KIND.directional;
        // Le soleil éclaire tout l'écran : sa priorité est maximale. Une ponctuelle vaut la part
        // d'écran que sa sphère d'influence occupe — la lampe la plus proche passe donc devant.
        coverage[slot] = sun
          ? 1
          : screenCoverage(
              view,
              packed[base],
              packed[base + 1],
              packed[base + 2],
              packed[base + LIGHT_FIELD.range],
            );
        const faces = faceCountOf(kind);
        if (slice < 0) slice = slices.claim();
        const side = desiredFaceSide(coverage[slot], faces, casters);
        if (slice < 0 || !slices.fit(slice, faces, side)) {
          counts.deny();
          coverage[slot] = 0;
          store.assignSlice(slot, -1);
          continue;
        }
        store.assignSlice(slot, slice);
        const light = store.light(store.ids[slot]);
        if (!light) continue;
        invalidateLightPages(
          slices,
          changes,
          light,
          slice,
          faces,
          slices.side[slice],
          store.revision[slot],
          view,
          nowMs,
          frame,
          byPage,
        );
        const rows = pageRowsOf(slices.side[slice]);
        let waiting = false;
        for (let face = 0; face < faces; face++) {
          if (!slices.dirty.isDirty(slice, face)) continue;
          waiting = true;
          candidateLight[candidates] = slot;
          candidateSlice[candidates] = slice;
          candidateFace[candidates] = face;
          candidateRows[candidates] = rows;
          candidatePriority[candidates] =
            coverage[slot] +
            (slices.drawn[slice] ? 0 : 1) +
            slices.dirty.waitedFrames(slice, face, frame) * LIGHT_SETTINGS.shadowAgingPerFrame;
          candidates++;
        }
        if (!waiting) counts.reusedLight();
      }
      // Les boîtes sont consommées : ce sont les pages qui portent désormais le travail restant.
      changes.settled();
      counts.invalidated(slices, store);
      admit(store, frame, candidates);
      counts.endFrame(slices, store, frame, nowMs);
      return regions.count;
    },
    reset() {
      slices.reset();
      changes.settled();
      budget.reset();
      regions.reset();
      counts.reset();
    },
  };
  /** Vide la file par priorité décroissante, sans tri : un balayage par région retenue. */
  function admit(store: SceneLightStore, frame: number, candidates: number) {
    let spent = 0;
    const accept = (pages: number) => {
      const cost = budget.estimate(pages);
      // La première région passe toujours : sans elle, une page attendrait indéfiniment sur un
      // appareil dont la moindre page dépasse déjà le budget, et le retard ne serait plus borné.
      if (cost !== null && regions.count > 0 && spent + cost > budget.budgetMs) return false;
      spent += cost ?? 0;
      return true;
    };
    for (let picked = 0; picked < candidates && regions.count < regions.capacity; picked++) {
      let best = -1,
        bestPriority = -Infinity;
      for (let i = 0; i < candidates; i++)
        if (candidatePriority[i] > bestPriority) {
          bestPriority = candidatePriority[i];
          best = i;
        }
      if (best < 0) break;
      candidatePriority[best] = -Infinity;
      const slice = candidateSlice[best];
      const before = regions.count;
      const complete = regions.addFace(
        slices.dirty,
        candidateLight[best],
        slice,
        candidateFace[best],
        candidateRows[best],
        accept,
      );
      if (regions.count > before) {
        slices.markDrawn(slice);
        counts.drewLight(candidateLight[best], store, frame);
      }
      if (!complete) break;
    }
    for (let i = 0; i < candidates; i++) candidatePriority[i] = 0;
  }
  return plan;
}
export { RECTS_PER_SLICE };
