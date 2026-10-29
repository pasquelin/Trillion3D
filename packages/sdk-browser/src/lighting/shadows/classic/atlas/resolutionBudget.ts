import { VSM_LEVEL0_TEXELS } from '../../vsm/constants.ts'
import { localMip } from '../denseLevels.ts'

/** A light's identity: the scene's id of it. */
export type LightKey = string | number

/** A local light a frame draws in its classic shadow: its identity (stable from frame to frame, unlike its map ids), whether it is a spot light (else a point light) and the resolution it asks. */
export interface BudgetedLight {
  readonly key: LightKey
  readonly spot: boolean
  resolution: number
}

/** The mip each light drew in last frame, by its key: a change of it is a full redraw of the light's maps. */
export type HeldMips = Map<LightKey, number>
/** How many frames in a row each light was held back by the limit, by its key. */
export type HeldWaits = Map<LightKey, number>

/** The share of the drop to the new size that the desired resolution must have covered for a map to shrink: the guard band that keeps a light from changing size back and forth. */
const SHRINK_GUARD = 0.5

/**
 * The cap on the lights whose maps are drawn again in full because their resolution moved to another mip, per frame, point lights and spot lights each with their own limit
 * (`shadowMaxPointCacheUpdatesPerFrame`, `shadowMaxSpotCacheUpdatesPerFrame`; a negative limit is none). A light past its kind's limit keeps the resolution of its mip of last frame
 * for this one, so its cached maps stay valid; a light drawn for the first time is never held. A map shrinks only once the resolution asked has dropped half of the way to the new size.
 * The lights that wait longest are served first (the order of the lights breaks a tie), so that a light does not starve behind others that change every frame. `held` and `waits` are
 * updated to what the frame draws, and forget the lights not in `lights`.
 */
export function capResolutionChanges(
  lights: readonly BudgetedLight[],
  held: HeldMips,
  limitPoint: number,
  limitSpot: number,
  waits: HeldWaits = new Map(),
) {
  const changing = lights.filter((light) => {
    const before = held.get(light.key)
    return before !== undefined && before !== localMip(light.resolution)
  })
  changing.sort((a, b) => (waits.get(b.key) ?? 0) - (waits.get(a.key) ?? 0))
  let points = 0
  let spots = 0
  for (const light of changing) {
    const before = held.get(light.key)!
    const used = light.spot ? ++spots : ++points
    const limit = light.spot ? limitSpot : limitPoint
    const size = VSM_LEVEL0_TEXELS >> before
    const next = VSM_LEVEL0_TEXELS >> localMip(light.resolution)
    const over = limit >= 0 && used > limit
    const drop = (size - light.resolution) / (size - next)
    const guarded = !over && next < size && drop > 0 && drop < SHRINK_GUARD
    if (over || guarded) {
      light.resolution = size
      if (light.spot) spots--
      else points--
      if (over) waits.set(light.key, (waits.get(light.key) ?? 0) + 1)
    } else waits.delete(light.key)
  }
  const seen = new Set<LightKey>()
  for (const light of lights) {
    seen.add(light.key)
    held.set(light.key, localMip(light.resolution))
  }
  for (const id of held.keys()) if (!seen.has(id)) held.delete(id)
  for (const id of waits.keys()) if (!seen.has(id)) waits.delete(id)
}
