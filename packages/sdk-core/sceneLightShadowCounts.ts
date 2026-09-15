import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type ShadowViewpoint,
} from './sceneLightContracts.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';

type Slices = ReturnType<typeof createShadowSliceTable>;

/** Le résultat d'un balayage de la file, réutilisé : deux balayages par image, aucune allocation. */
const swept = { pages: 0, ms: 0, images: 0 };

/** Rayon angulaire de la sphère d'influence rapporté au demi-champ : approximation nommée (P5). */
export function screenCoverage(
  view: ShadowViewpoint,
  x: number,
  y: number,
  z: number,
  range: number,
) {
  const dx = x - view.position[0],
    dy = y - view.position[1],
    dz = z - view.position[2];
  const distance = Math.hypot(dx, dy, dz);
  const ahead = dx * view.forward[0] + dy * view.forward[1] + dz * view.forward[2];
  if (ahead + range < 0 || distance - range > view.far) return 0;
  const ratio = Math.atan(range / Math.max(distance, 1e-3)) / view.halfFovY;
  return Math.min(1, ratio * ratio);
}

/** Le type et la tranche d'une lampe à ombre, ou `-1` quand elle n'en a pas. */
function shadowSliceOf(store: SceneLightStore, slot: number) {
  const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
  if (store.packed[base + LIGHT_FIELD.castsShadow] === 0) return -1;
  return store.sliceOf(slot);
}

/**
 * Ce que la passe d'ombres a réellement fait : des pages, jamais des durées. Pages invalidées par
 * l'image, pages redessinées, pages restées en attente, et le retard de la plus ancienne d'entre
 * elles — en millisecondes et en images. Tout est alloué une fois.
 */
export function createShadowCounts() {
  const drewAt = new Int32Array(LIGHT_SETTINGS.maxLights);
  let denied = 0,
    reused = 0,
    lights = 0,
    sunLights = 0,
    invalidatedPages = 0,
    pendingPages = 0,
    waitedMs = 0,
    waitedFrames = 0;
  /** Pages en attente sur toutes les faces que les lampes à ombre déclarées possèdent. */
  const scan = (slices: Slices, store: SceneLightStore, frame: number, nowMs: number) => {
    swept.pages = 0;
    swept.ms = 0;
    swept.images = 0;
    for (let slot = 0; slot < store.count; slot++) {
      const slice = shadowSliceOf(store, slot);
      if (slice < 0) continue;
      const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
      const count = faceCountOf(store.packed[base + LIGHT_FIELD.kind]);
      for (let face = 0; face < count; face++) {
        if (!slices.dirty.isDirty(slice, face)) continue;
        swept.pages += slices.dirty.pages(slice, face);
        swept.ms = Math.max(swept.ms, slices.dirty.waitedMs(slice, face, nowMs));
        swept.images = Math.max(swept.images, slices.dirty.waitedFrames(slice, face, frame));
      }
    }
    return swept;
  };
  return {
    get denied() {
      return denied;
    },
    get reused() {
      return reused;
    },
    /** Lampes dont au moins une région a été redessinée par cette image. */
    get lights() {
      return lights;
    },
    get sunLights() {
      return sunLights;
    },
    get invalidatedPages() {
      return invalidatedPages;
    },
    get pendingPages() {
      return pendingPages;
    },
    /** Retard de la page qui attend depuis le plus longtemps, en millisecondes et en images. */
    get waitedMs() {
      return waitedMs;
    },
    get waitedFrames() {
      return waitedFrames;
    },
    beginFrame() {
      denied = 0;
      reused = 0;
      lights = 0;
      sunLights = 0;
      invalidatedPages = 0;
    },
    deny() {
      denied++;
    },
    reusedLight() {
      reused++;
    },
    /** Une région vient d'être retenue pour cette lampe : elle ne compte qu'une fois par image. */
    drewLight(slot: number, store: SceneLightStore, frame: number) {
      if (drewAt[slot] === frame + 1) return;
      drewAt[slot] = frame + 1;
      lights++;
      const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
      if (store.packed[base + LIGHT_FIELD.kind] === LIGHT_KIND.directional) sunLights++;
    },
    /** Pages entrées en file cette image, comptées à l'entrée et non déduites d'une différence. */
    invalidated(slices: Slices) {
      invalidatedPages = slices.dirty.invalidated;
    },
    /** Ce qui reste après l'admission : la file, son retard, et le point de départ de l'image suivante. */
    endFrame(slices: Slices, store: SceneLightStore, frame: number, nowMs: number) {
      const rest = scan(slices, store, frame, nowMs);
      pendingPages = rest.pages;
      waitedMs = rest.ms;
      waitedFrames = rest.images;
    },
    reset() {
      denied = 0;
      reused = 0;
      lights = 0;
      sunLights = 0;
      invalidatedPages = 0;
      pendingPages = 0;
      waitedMs = 0;
      waitedFrames = 0;
      drewAt.fill(0);
    },
  };
}
