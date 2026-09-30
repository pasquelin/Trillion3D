import type { PageSurface } from '../page/surface.ts';
import { MIRROR_TRANSITION_END, SCREEN_REFLECTION_CUTOFF } from './modelShader.ts';

/** Every lit physical surface has a specular lobe, including a fully rough dielectric. */
const reflects = (surface: PageSurface) => surface.lit && (surface.model ?? 0) === 0;

/** The receivers with a specular lobe under `limit` somewhere: a roughness map can lower any
 *  factor under it, so a mapped surface stays eligible and the shader cuts per pixel. */
const reflectsUnder = (limit: number) => (surface: PageSurface) =>
  reflects(surface) && (!!surface.roughnessMap || surface.roughness < limit);

/** A screen-traced receiver: under Unreal's maximum roughness (#1341). */
export const screenReflects = reflectsUnder(SCREEN_REFLECTION_CUTOFF);

/** A WebGL2 screen-traced receiver: its base lobe, or a clear coat's own lobe, which the WebGL2
 *  program reflects apart on the coat's roughness (`mirrorLighting` on `coatNormal`). */
export const coatedScreenReflects = (surface: PageSurface) =>
  screenReflects(surface) ||
  (reflects(surface) &&
    (surface.clearcoat ?? 0) > 0 &&
    (!!surface.clearcoatRoughnessMap ||
      (surface.clearcoatRoughness ?? 0) < SCREEN_REFLECTION_CUTOFF));

/** A mirror receiver: the surfaces the reduced-resolution resolve precomputes (#1292). */
export const mirrorRange = reflectsUnder(Number(MIRROR_TRANSITION_END));
