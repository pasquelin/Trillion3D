import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { desiredFaceSide } from './sceneLightShadowAtlas.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import { createShadowSliceTable, RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';
import { createShadowChanges } from './sceneLightShadowChanges.ts';

export type ShadowPlan = ReturnType<typeof createShadowPlan>;

/**
 * L'ordonnanceur d'ombres : au plus `shadowUpdatesPerFrame` lampes redessinées par image, choisies
 * par influence écran parmi celles qui ont changé — la lampe elle-même, ou un occulteur déplacé dans
 * sa portée. Une lampe fixe dans une scène fixe garde sa tranche et ne coûte rien (X5). Tous les
 * tableaux sont alloués une fois ; `plan()` n'allouera jamais.
 */
export function createShadowPlan() {
  const slices = createShadowSliceTable();
  const candidateSlot = new Int32Array(MAX_SHADOW_SLICES),
    candidatePriority = new Float64Array(MAX_SHADOW_SLICES),
    coverage = new Float64Array(LIGHT_SETTINGS.maxLights);
  const updatedLight = new Int32Array(LIGHT_SETTINGS.shadowUpdatesPerFrame),
    updatedSlice = new Int32Array(LIGHT_SETTINGS.shadowUpdatesPerFrame);
  const changes = createShadowChanges();
  let denied = 0,
    pending = 0,
    reused = 0,
    sunUpdates = 0;
  /** Rayon angulaire de la sphère d'influence rapporté au demi-champ : approximation nommée (P5). */
  const screenCoverage = (
    view: ShadowViewpoint,
    x: number,
    y: number,
    z: number,
    range: number,
  ) => {
    const dx = x - view.position[0],
      dy = y - view.position[1],
      dz = z - view.position[2];
    const distance = Math.hypot(dx, dy, dz);
    const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2];
    if (ahead + range < 0 || distance - range > view.far) return 0;
    const ratio = Math.atan(range / Math.max(distance, 1e-3)) / view.halfFovY;
    return Math.min(1, ratio * ratio);
  };
  const plan = {
    slices,
    coverage,
    updatedLight,
    updatedSlice,
    get pending() {
      return pending;
    },
    /** Cascades du soleil redessinées par la dernière image, distinguées des lampes ponctuelles. */
    get sunUpdates() {
      return sunUpdates;
    },
    /** Lampes à ombre dont la carte en cache est restée valable : zéro dessin pour elles (X5). */
    get reused() {
      return reused;
    },
    /** Tranches refusées faute de place dans l'atlas, publiées telles quelles dans le diagnostic. */
    get denied() {
      return denied;
    },
    /** Un nœud a bougé : la boîte s'unit à celle des mouvements que les ombres n'ont pas rattrapés. */
    worldChanged: changes.worldChanged,
    /**
     * Choisit les lampes de cette image. Rend le nombre de lampes retenues ; `updatedLight[i]` est le
     * rang de la lampe dans le magasin, `updatedSlice[i]` sa tranche d'atlas.
     */
    plan(store: SceneLightStore, view: ShadowViewpoint) {
      const { packed } = store;
      changes.noteView(view);
      let candidates = 0,
        behind = 0,
        casters = 0;
      denied = 0;
      reused = 0;
      sunUpdates = 0;
      // Les demandeurs d'abord : la part d'atlas d'une lampe dépend de combien d'autres en veulent.
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
        const x = packed[base],
          y = packed[base + 1],
          z = packed[base + 2],
          range = packed[base + LIGHT_FIELD.range];
        const kind = packed[base + LIGHT_FIELD.kind];
        const sun = kind === LIGHT_KIND.directional;
        // Le soleil éclaire tout l'écran : sa priorité est maximale, et ses cascades suivent la
        // caméra, donc la révision de la vue entre dans leur fraîcheur. Une ponctuelle, elle, ne
        // dépend que de sa propre révision et de ce qui a bougé dans sa portée.
        coverage[slot] = sun ? 1 : screenCoverage(view, x, y, z, range);
        const faces = faceCountOf(kind);
        if (slice < 0) slice = slices.claim();
        const side = desiredFaceSide(coverage[slot], faces, casters);
        if (slice < 0 || !slices.fit(slice, faces, side)) {
          denied++;
          coverage[slot] = 0;
          store.assignSlice(slot, -1);
          continue;
        }
        store.assignSlice(slot, slice);
        const touched = sun ? changes.worldMoved : changes.touchesMoved(x, y, z, range);
        const freshness = sun ? changes.viewEpoch : 0;
        if (!slices.stale(slice, store.revision[slot], changes.worldEpoch, touched, freshness)) {
          reused++;
          continue;
        }
        behind++;
        candidateSlot[candidates] = slot;
        candidatePriority[candidates] = coverage[slot] + (slices.drawn[slice] ? 0 : 1);
        candidates++;
      }
      // Sélection des plus influentes sans tri : au plus `shadowUpdatesPerFrame` passes sur la liste.
      let chosen = 0;
      for (; chosen < updatedLight.length && chosen < candidates; chosen++) {
        let best = -1,
          bestPriority = -1;
        for (let i = 0; i < candidates; i++)
          if (candidatePriority[i] > bestPriority) {
            bestPriority = candidatePriority[i];
            best = i;
          }
        if (best < 0) break;
        const slot = candidateSlot[best];
        candidatePriority[best] = -1;
        updatedLight[chosen] = slot;
        updatedSlice[chosen] = store.sliceOf(slot);
        const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
        const sun = packed[base + LIGHT_FIELD.kind] === LIGHT_KIND.directional;
        if (sun) sunUpdates++;
        slices.refreshed(
          updatedSlice[chosen],
          store.revision[slot],
          changes.worldEpoch,
          sun ? changes.viewEpoch : 0,
        );
      }
      pending = Math.max(0, behind - chosen);
      if (!pending) changes.settled();
      return chosen;
    },
    reset() {
      slices.reset();
      changes.settled();
      pending = 0;
      reused = 0;
      sunUpdates = 0;
    },
  };
  return plan;
}
export { RECTS_PER_SLICE };
