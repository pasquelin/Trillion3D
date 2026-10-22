import { Color } from '../../../../sdk-core/src/world/math/color.ts'
import type {
  SceneExponentialFog,
  SceneFog,
  SceneHeightFog,
  SceneLinearFog,
} from '../../../../sdk-core/src/scene/core/fog.ts'

/** Fog over every surface: linear from `near` to `far`; thickening with distance by `density`,
 *  thinning out with height above `baseHeight` when `heightFalloff` is set; or the height fog's own
 *  fields (`baseDensity`, `falloff`, `maxOpacity`, the sun's lobe... all with their defaults, `{}`
 *  the default fog). The colour is light the fog scatters toward the eye, exposed and tone-mapped
 *  like a surface's; a height fog's, black by default, is added to what an atmosphere scatters. */
export type Fog =
  | (Omit<SceneLinearFog, 'color'> & { color: Color })
  | (Omit<SceneExponentialFog, 'color'> & { color: Color })
  | (Omit<SceneHeightFog, 'color'> & { color?: Color })

/** A fog as the lighting reads it: its colour's linear components, the law as written. */
export const sceneFogOf = (fog: Fog | null): SceneFog | undefined => {
  if (!fog) return undefined
  const { color, ...law } = fog
  return (color ? { ...law, color: [color.r, color.g, color.b] as const } : law) as SceneFog
}

/** A fog as a scene holds it, from the lighting's: its colour's components in a colour. */
export const fogOf = (fog: SceneFog | null | undefined): Fog | null => {
  if (!fog) return null
  const { color, ...law } = fog as SceneFog & { color?: SceneFog['color'] }
  return (color ? { ...law, color: new Color().setRGB(...color) } : law) as Fog
}
