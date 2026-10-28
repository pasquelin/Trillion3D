import {
  readShadowSetting,
  type ShadowField,
} from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  tessellationAsked,
  tessellationWanted,
} from '../../../../visibility/tessellation/wanted.ts'
import { shadowLodScale } from './shadowLodScale.ts'

/**
 * The shadow settings that change what a page of the maps holds: the level of detail of the casters, the clipmap levels and their bias, the resolution and the
 * maps' own filtering. The distance scale, the occlusion culling, the multipass switch and the contact shadows move no page (`shadowOptions.ts`); the pool's size
 * makes the set again, which empties its cache.
 */
const PAGE_CONTENT: readonly ShadowField[] = [
  'shadowGeometryLodBias',
  'shadowNearLevels',
  'shadowClipmapFirstLevel',
  'shadowClipmapLastLevel',
  'shadowOrthoClipmapLodBias',
  'shadowResolutionLodBiasDirectional',
  'shadowResolutionLodBiasDirectionalMoving',
  'shadowResolutionLodBiasLocal',
  'shadowResolutionLodBiasLocalMoving',
  'shadowMaxResolution',
  'shadowPrefilteredDistant',
]

/** The key of what the cached pages hold, rewritten into `into`: the settings of `PAGE_CONTENT`, the tessellation's capacity (a page drawn by a smaller one
 *  lost patches the larger keeps) and the scale of the level of detail (`shadowLodScale`). */
function contentKey(rt: WebgpuPagesRuntime, into: number[]) {
  into.length = 0
  for (const field of PAGE_CONTENT) into.push(Number(readShadowSetting(rt, field)))
  const capacity = tessellationWanted(rt) ? tessellationAsked(rt) : undefined
  into.push(
    capacity?.candidate ?? 0,
    capacity?.visible ?? 0,
    capacity?.records ?? 0,
    shadowLodScale(rt),
  )
  return into
}

/** The key each cache was last drawn under, and the scratch the next is worked out in. */
const kept = new WeakMap<object, number[]>()
const scratch: number[] = []

/**
 * The maps' cache, empty of what was drawn under another content key: at the entry of the shadow plan, before any page of the frame is marked or kept, the key of the
 * pages (`contentKey`) is compared to the one the cache was last drawn under, and a change empties it, as the key of a light's cache entry does (`lightCache.ts`). The first
 * reading keeps the key and drops nothing.
 */
export function followCacheContent(rt: WebgpuPagesRuntime) {
  const cache = rt.lights.vsm?.state.cache
  if (!cache) return
  const key = contentKey(rt, scratch)
  const was = kept.get(cache)
  if (!was) return void kept.set(cache, [...key])
  if (key.every((value, at) => Object.is(value, was[at]))) return
  was.splice(0, was.length, ...key)
  cache.invalidate()
}
