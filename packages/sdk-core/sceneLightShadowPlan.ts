import {
  LIGHT_SETTINGS,
  MAX_SHADOW_SLICES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
} from './sceneLightContracts.ts';
import { desiredFaceSide } from './sceneLightShadowAtlas.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import { createShadowSliceTable, RECTS_PER_SLICE } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';

/** Ce que l'ordonnanceur sait de la vue : une caméra, pas une matrice, pour rester sans dépendance. */
export interface ShadowViewpoint {
  position: readonly [number, number, number];
  forward: readonly [number, number, number];
  halfFovY: number;
  far: number;
}
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
  const moved = { min: [0, 0, 0], max: [0, 0, 0], valid: false };
  let worldEpoch = 1,
    denied = 0,
    pending = 0,
    reused = 0;
  /** Écart d'une coordonnée à l'intervalle de la boîte déplacée, nul à l'intérieur. */
  const outside = (value: number, axis: number) =>
    Math.max(moved.min[axis] - value, value - moved.max[axis], 0);
  /** Sphère d'influence de la lampe contre la boîte déplacée : un test analytique, pas un rayon. */
  const touchesMoved = (x: number, y: number, z: number, range: number) => {
    if (!moved.valid) return false;
    const dx = outside(x, 0),
      dy = outside(y, 1),
      dz = outside(z, 2);
    return dx * dx + dy * dy + dz * dz <= range * range;
  };
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
    /** Lampes à ombre dont la carte en cache est restée valable : zéro dessin pour elles (X5). */
    get reused() {
      return reused;
    },
    /** Tranches refusées faute de place dans l'atlas, publiées telles quelles dans le diagnostic. */
    get denied() {
      return denied;
    },
    /** Un nœud a bougé : la boîte s'unit à celle des mouvements que les ombres n'ont pas rattrapés. */
    worldChanged(min: readonly number[], max: readonly number[]) {
      for (let axis = 0; axis < 3; axis++) {
        moved.min[axis] = moved.valid ? Math.min(moved.min[axis], min[axis]) : min[axis];
        moved.max[axis] = moved.valid ? Math.max(moved.max[axis], max[axis]) : max[axis];
      }
      moved.valid = true;
      worldEpoch++;
    },
    /**
     * Choisit les lampes de cette image. Rend le nombre de lampes retenues ; `updatedLight[i]` est le
     * rang de la lampe dans le magasin, `updatedSlice[i]` sa tranche d'atlas.
     */
    plan(store: SceneLightStore, view: ShadowViewpoint) {
      const { packed } = store;
      let candidates = 0,
        behind = 0,
        casters = 0;
      denied = 0;
      reused = 0;
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
        coverage[slot] = screenCoverage(view, x, y, z, range);
        const faces = faceCountOf({
          kind: packed[base + LIGHT_FIELD.kind] === 1 ? 'spot' : 'point',
        });
        if (slice < 0) slice = slices.claim();
        const side = desiredFaceSide(coverage[slot], faces, casters);
        if (slice < 0 || !slices.fit(slice, faces, side)) {
          denied++;
          coverage[slot] = 0;
          store.assignSlice(slot, -1);
          continue;
        }
        store.assignSlice(slot, slice);
        if (!slices.stale(slice, store.revision[slot], worldEpoch, touchesMoved(x, y, z, range))) {
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
        slices.refreshed(updatedSlice[chosen], store.revision[slot], worldEpoch);
      }
      pending = Math.max(0, behind - chosen);
      if (!pending) moved.valid = false;
      return chosen;
    },
    reset() {
      slices.reset();
      moved.valid = false;
      pending = 0;
      reused = 0;
    },
  };
  return plan;
}
export { RECTS_PER_SLICE };
