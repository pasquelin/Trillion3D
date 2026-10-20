/**
 * HOW MANY MAPS A LIGHT TAKES AND HOW MANY MIPS THE RASTER DRAWS OF EACH: the one rule of the
 * local setup's maps (`localLight.ts`), the raster's view bound (`vsmRenderViewBound`, every light
 * the frame shadows) and the engine's bound before the frame's lights are set up
 * (`webgpu/pages/render/vsm/vsmLightMaps.ts`). The GPU lists the views that have pages to draw
 * (`renderViewsWgsl.ts`), by the same mips.
 */
import { VSM_MIPS, VSM_SUN_COARSEST_LEVEL, VSM_SUN_FINEST_LEVEL } from './constants.ts'

type LightKind = 'directional' | 'point' | 'spot' | 'rect' | (string & {})

/** The maps a light of `kind` takes when it casts: a clipmap's levels for a sun (at most: an
 *  orthographic camera may start coarser), six cube faces for a point light, one for a spot. */
export const vsmMapsOf = (kind: LightKind) =>
  kind === 'directional'
    ? VSM_SUN_COARSEST_LEVEL - VSM_SUN_FINEST_LEVEL + 1
    : kind === 'point'
      ? 6
      : kind === 'spot'
        ? 1
        : 0

/** The mips the raster draws of one map of a light of `kind`: a clipmap level's one, a local map's
 *  every mip. */
const vsmMapViewMips = (kind: LightKind) => (kind === 'directional' ? 1 : VSM_MIPS)

/** The raster's views of `maps` maps of each light (`vsmMapsOf` where none is given) and the mip
 *  views they hold in all: what the views' list and the commands are sized for. */
export function vsmRenderViewBound(lights: readonly { kind: LightKind; count?: number }[]) {
  let views = 0,
    viewMips = 0
  for (const light of lights) {
    const maps = light.count ?? vsmMapsOf(light.kind)
    views += maps
    viewMips += maps * vsmMapViewMips(light.kind)
  }
  return { views, viewMips }
}
