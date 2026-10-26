/**
 * HOW MANY MAPS A LIGHT TAKES AND HOW MANY MIPS THE RASTER DRAWS OF EACH: the one rule of the
 * local setup's maps (`localLight.ts`), the raster's view passes (`render/renderViewPasses.ts`)
 * and the engine's bound before the frame's lights are set up
 * (`lighting/shadows/vsm/frame/vsmLightMaps.ts`). The GPU lists the views that have pages to draw
 * (`render/renderViewsWgsl.ts`), by the same mips.
 */
import { VSM_MIPS } from './constants.ts'
import { VSM_DEFAULT_SHADOWS, vsmSunLevels } from './mapSettings.ts'
import type { VsmLightAllocation } from './frameSetup.ts'

type LightKind = 'directional' | 'point' | 'spot' | 'rect' | (string & {})

/** The clipmap levels a sun takes when its host names none: the defaults' (`vsmSunLevels`). */
export const VSM_DEFAULT_SUN_LEVELS = vsmSunLevels(VSM_DEFAULT_SHADOWS)

/** The maps a light of `kind` takes when it casts: a clipmap's `sunLevels` for a sun (at most: an
 *  orthographic camera may start coarser), six cube faces for a point light or a rectangle, one
 *  for a spot. */
export const vsmMapsOf = (kind: LightKind, sunLevels = VSM_DEFAULT_SUN_LEVELS) =>
  kind === 'directional'
    ? sunLevels
    : kind === 'spot'
      ? 1
      : kind === 'point' || kind === 'rect'
        ? 6
        : 0

/** The mips the raster draws of one map of a light of `kind`: a clipmap level's one, a local map's
 *  every mip. */
const vsmMapViewMips = (kind: LightKind) => (kind === 'directional' ? 1 : VSM_MIPS)

/** A light as the raster's views count it: its kind and, once the frame's maps are set up, its map
 *  count and its first map's id. */
export interface VsmViewLight {
  kind: LightKind
  count?: number
  firstId?: number
}

/** The maps of one light of the frame: its own count, else those its kind takes. */
export const vsmLightMaps = (light: VsmViewLight) => light.count ?? vsmMapsOf(light.kind)

/** The mip views the raster draws of one light's maps. */
export const vsmLightMips = (light: VsmViewLight) =>
  vsmLightMaps(light) * vsmMapViewMips(light.kind)

/** A light as the raster binds it (`render/renderPass.ts`): its kind, its first map's id and its map
 *  count, and its clipmap or cache entry where it has one. */
export type VsmBoundLight = Pick<VsmLightAllocation, 'kind' | 'firstId' | 'count'> &
  Partial<Pick<VsmLightAllocation, 'clipmap' | 'entry'>>
