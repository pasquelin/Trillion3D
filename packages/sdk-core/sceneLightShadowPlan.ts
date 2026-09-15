import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
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
import { createShadowAdmission } from './sceneLightShadowAdmit.ts';

export type ShadowPlan = ReturnType<typeof createShadowPlan>;

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
  const queue = createShadowAdmission(regions, budget, counts);
  return {
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
      queue.reset();
      counts.beginFrame();
      slices.dirty.beginFrame();
      let casters = 0;
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
          // Priorité : la lampe la plus visible d'abord, une carte jamais dessinée avant tout, et
          // l'attente déjà subie, qui monte d'image en image et empêche la famine.
          queue.add(
            slot,
            slice,
            face,
            rows,
            coverage[slot] +
              (slices.drawn[slice] ? 0 : 1) +
              slices.dirty.waitedFrames(slice, face, frame) * LIGHT_SETTINGS.shadowAgingPerFrame,
          );
        }
        if (!waiting) counts.reusedLight();
      }
      // Les boîtes sont consommées : ce sont les pages qui portent désormais le travail restant.
      changes.settled();
      queue.run(slices, store, frame);
      counts.endFrame(slices, store, frame, nowMs);
      return regions.count;
    },
    /**
     * Les régions de cette image n'ont pas pu être encodées : leurs pages retournent en file. Elles
     * en étaient sorties à l'admission, parce que l'ordonnanceur et la passe ne se parlent que par
     * cette liste ; si la passe ne dessine rien, la file doit les retrouver.
     */
    reissue(frame: number, nowMs: number) {
      for (let region = 0; region < regions.count; region++)
        slices.dirty.undrew(
          regions.sliceOf(region),
          regions.faceOf(region),
          regions.x0Of(region),
          regions.x1Of(region),
          regions.y0Of(region),
          regions.y1Of(region),
          nowMs,
          frame,
        );
      regions.reset();
    },
    reset() {
      slices.reset();
      changes.settled();
      budget.reset();
      regions.reset();
      counts.reset();
    },
  };
}
export { RECTS_PER_SLICE };
