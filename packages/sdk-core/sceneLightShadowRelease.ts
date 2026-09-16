import {
  MAX_SHADOW_SLICES,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
} from './sceneLightContracts.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import { LIGHT_FIELD, type SceneLightStore } from './sceneLightStore.ts';

type Slices = ReturnType<typeof createShadowSliceTable>;

/**
 * L'unique voie de libération d'une tranche d'ombre.
 *
 * Une tranche n'appartient qu'à une lampe **vivante** du magasin qui porte encore une ombre. Tout le
 * reste la rend : la lampe qui passe à `castsShadow = 0`, et la lampe qui quitte le magasin — par un
 * retrait isolé, par un retrait au milieu de la liste (le magasin déplace alors la dernière lampe et
 * sa tranche avec elle, ce que ce balayage lit tel quel), ou par le vidage complet de la liste. Un
 * seul chemin, donc un seul comportement : la tranche redevient libre, ses pages en attente sont
 * oubliées et ses cellules d'atlas sont rendues, y compris quand une mise à jour d'ombre était en
 * file pour elle. Sans cela, une lampe retirée emporterait sa tranche dans la tombe et les
 * soixante-quatre tranches finiraient prises sans qu'aucune lampe n'en tienne une.
 *
 * Le balayage lit le magasin, jamais un événement : rien à désabonner, rien à rejouer, et un magasin
 * partagé par plusieurs moteurs donne le même verdict à chacun. Deux passes bornées par les mêmes
 * soixante-quatre entrées, sans allocation.
 */
export function createShadowRelease() {
  const claimed = new Uint8Array(MAX_SHADOW_SLICES);
  return (slices: Slices, store: SceneLightStore) => {
    claimed.fill(0);
    for (let slot = 0; slot < store.count; slot++) {
      const slice = store.sliceOf(slot);
      if (slice < 0) continue;
      const base = SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS;
      // La lampe est là mais n'éclaire plus d'ombre : elle lâche sa tranche ici, comme une partie.
      if (store.packed[base + LIGHT_FIELD.castsShadow] === 0) store.assignSlice(slot, -1);
      else claimed[slice] = 1;
    }
    for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
      if (slices.taken[slice] && !claimed[slice]) slices.free(slice);
  };
}
