import type { PageSurface } from '../page/surface.ts';
import { MIRROR_TRANSITION_END, SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts';

/** Every lit physical surface has a specular lobe, including a fully rough dielectric. */
export const reflects = (surface: PageSurface) => surface.lit && (surface.model ?? 0) === 0;

/** A screen-traced receiver: a specular lobe under the cutoff somewhere (#1341). A roughness map
 *  can lower any factor under it, so a mapped surface stays eligible; the shader cuts per pixel. */
export const screenReflects = (surface: PageSurface) =>
  reflects(surface) &&
  (!!surface.roughnessMap || surface.roughness < Number(SCREEN_REFLECTION_MAX_ROUGHNESS));

/** A mirror receiver: the surfaces the reduced-resolution resolve precomputes (#1292). A roughness
 *  map can lower any factor to the mirror range, so it stays eligible. */
export const mirrorRange = (surface: PageSurface) =>
  reflects(surface) &&
  (!!surface.roughnessMap || surface.roughness < Number(MIRROR_TRANSITION_END));
