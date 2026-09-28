import type { PageSurface } from '../page/surface.ts';
import { MIRROR_TRANSITION_END } from '../bounce/reflectWgsl.ts';

/** A roughness map can lower any factor to the mirror range; it must remain eligible. */
export const reflects = (surface: PageSurface) =>
  surface.lit &&
  (surface.model ?? 0) === 0 &&
  (!!surface.roughnessMap || surface.roughness < Number(MIRROR_TRANSITION_END));
