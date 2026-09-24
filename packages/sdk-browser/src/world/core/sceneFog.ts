import type { Color } from '../../../../sdk-core/src/world/math/color.ts';
import type {
  SceneExponentialFog,
  SceneFog,
  SceneLinearFog,
} from '../../../../sdk-core/src/scene/core/fog.ts';

/** Fog over every lit surface: linear from `near` to `far`, or thickening with distance by
 *  `density`, thinning out with height above `baseHeight` when `heightFalloff` is set. The
 *  colour is light the fog scatters toward the eye, exposed and tone-mapped like a surface's. */
export type Fog =
  | (Omit<SceneLinearFog, 'color'> & { color: Color })
  | (Omit<SceneExponentialFog, 'color'> & { color: Color });

/** A fog as the lighting reads it: its colour's linear components, the law as written. */
export const sceneFogOf = (fog: Fog | null): SceneFog | undefined =>
  fog ? { ...fog, color: [fog.color.r, fog.color.g, fog.color.b] } : undefined;
