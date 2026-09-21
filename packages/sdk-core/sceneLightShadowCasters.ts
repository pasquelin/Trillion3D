import {
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  MAX_SHADOW_SLICES,
  POINT_FACES,
} from './sceneLightContracts.ts';
import { faceCountOf } from './sceneLightShadowFaces.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';

/** First float of light `slot` in the packed store. */
const baseOf = (slot: number) => SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;

/** True when the light at `slot` declares a shadow, whether or not it holds a slice yet. */
export const castsShadow = (store: SceneLightStore, slot: number) =>
  store.packed[baseOf(slot) + LIGHT_FIELD.castsShadow] !== 0;

/** Lights that declare a shadow: what the atlas side is shared between. */
export function countShadowCasters(store: SceneLightStore) {
  let casters = 0;
  for (let slot = 0; slot < store.count; slot++) if (castsShadow(store, slot)) casters++;
  return casters;
}

/**
 * Visits every face of every light that declares a shadow and holds a slice: the one scan the
 * counters, the held-mask publication and every other per-face reader share. The face count
 * is that of the light's kind; `fn` is bounded by the published slices and faces.
 */
export function forEachShadowFace(
  store: SceneLightStore,
  fn: (slot: number, slice: number, face: number) => void,
) {
  for (let slot = 0; slot < store.count; slot++) {
    if (!castsShadow(store, slot)) continue;
    const slice = store.sliceOf(slot);
    if (slice < 0 || slice >= MAX_SHADOW_SLICES) continue;
    const faces = Math.min(POINT_FACES, faceCountOf(store.packed[baseOf(slot) + LIGHT_FIELD.kind]));
    for (let face = 0; face < faces; face++) fn(slot, slice, face);
  }
}
