import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { rootWorldBox } from '../../../../geometry/selection/rootWorld.ts'
import { shadowRootAt, shadowRootCount } from '../../casters/shadowRoots.ts'
import { MOBILITY_OFTEN_MOVING, MOBILITY_SHADOWLESS } from '../../mobilityBits.ts'
import { cascadeCount, cascadeSphereOf } from '../../classic/cascadeSplits.ts'
import { viewCascadesOf } from '../../classic/classicView.ts'
import { sunLevelIndex } from '../../classic/denseLevels.ts'
import {
  planCascadeCaches,
  type CascadeNow,
  type CascadeRecord,
  type CascadeRoots,
} from '../../classic/atlas/csmCache.ts'
import { classicCascadeResolution } from '../../classic/atlas/atlasPlan.ts'
import { VSM_UNIT_PER_CM } from '../constants.ts'
import { vsmClipmapCascadeMap } from '../clipmap.ts'
import { vsmClipmapConfig } from '../mapSettings.ts'
import type { VsmLightCache } from '../lightCache.ts'
import type { VsmFramePlan } from '../frameSetup.ts'
import { nearInCentimetres } from '../../classic/denseEntries.ts'
import { sunCascadesOf } from './vsmDense.ts'

/** The cascade records of each sun's cache entry. */
const held = new WeakMap<VsmLightCache, CascadeRecord[]>()
/** The clipmap level each cascade's map was last made from, by sun entry: a map made from another level holds pages of another place, none carried. */
const levelsHeld = new WeakMap<VsmLightCache, number[]>()
/** The cascades of the sun being planned: objects kept from frame to frame and written in place, the first of them current. */
type CascadeSlot = { -readonly [K in keyof CascadeNow]: CascadeNow[K] } & {
  centre: [number, number, number]
}
const nowPool: CascadeSlot[] = []
const rootsHeld = new WeakMap<WebgpuPagesRuntime, CascadeRoots>()

/** The static casters of the layout: placements that cast shadows and are not often moving, with a world box. Read live, so one object serves every frame of a runtime. */
const rootsOf = (rt: WebgpuPagesRuntime): CascadeRoots => {
  let roots = rootsHeld.get(rt)
  if (!roots)
    rootsHeld.set(
      rt,
      (roots = {
        get count() {
          return shadowRootCount(rt)
        },
        objectAt: (rank) => rt.layout.selectionRoots[rank]!,
        staticBox(rank) {
          const root = shadowRootAt(rt, rank)
          if (
            !root ||
            rt.lights.mobility.words[rank]! & (MOBILITY_OFTEN_MOVING | MOBILITY_SHADOWLESS)
          )
            return undefined
          return rootWorldBox(root)
        },
      }),
    )
  return roots
}

/**
 * THE CLASSIC CASCADES' MAPS AND THEIR CACHE (`shadowVirtualEnable` off): each cascade of a sun is a shadow map of its own, one past the sun's clipmap levels (`vsmClipmapCascadeMap`),
 * made over the geometry of the level its sphere's texels fit and keeping its own pages and cache state. With `shadowCsmCaching`, the mode the cache takes for each cascade this frame
 * (`planCascadeCaches`) and the cascades whose pages are not carried from the frame before (the cascade's cache is drawn again). Run once for a kept plan, before its next-map data goes up.
 */
export function applyCascades(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  plan: VsmFramePlan,
  shadows: ShadowValues,
  maxTextureSide: number,
) {
  if (shadows.shadowVirtualEnable || cam.perspective <= 0.5) return
  const store = rt.lights?.store
  if (!store) return
  const settings = {
    enabled: true,
    overlapAreaThrottle: shadows.shadowCsmScrollingOverlapAreaThrottle,
    maxExtraStaticSubjects: shadows.shadowMaxCsmScrollingStaticSubjects,
  }
  const view = viewCascadesOf(shadows, nearInCentimetres(cam.near))
  const wpoInvalidates = vsmClipmapConfig(shadows).wpoInvalidatesOnScale
  const cascadeResolution = classicCascadeResolution(shadows, maxTextureSide)
  const tanX = 1 / cam.projection[0]!
  const tanY = 1 / cam.projection[5]!
  const forward = [-cam.world[8]!, -cam.world[9]!, -cam.world[10]!] as const
  for (const lane of plan.projected) {
    const { clipmap } = lane
    const light = clipmap && !lane.firstPerson ? store.light(lane.id) : undefined
    if (!clipmap || !light) continue
    const sun = sunCascadesOf(light)
    const first = clipmap.levels.length
    const n = Math.min(cascadeCount(sun, view), lane.entry.mapCaches.length - first)
    let levels = levelsHeld.get(lane.entry)
    if (!levels) levelsHeld.set(lane.entry, (levels = []))
    for (let k = 0; k < n; k++) {
      const sphere = cascadeSphereOf(sun, view, k, tanX, tanY)
      const along = sphere.depth * VSM_UNIT_PER_CM
      const now = (nowPool[k] ??= { centre: [0, 0, 0], radius: 0, level: 0 })
      now.centre[0] = cam.eye[0]! + forward[0] * along
      now.centre[1] = cam.eye[1]! + forward[1] * along
      now.centre[2] = cam.eye[2]! + forward[2] * along
      now.radius = sphere.radius * VSM_UNIT_PER_CM
      now.level = sunLevelIndex(sphere.radius, cascadeResolution, clipmap.firstLevel, first)
      const map = vsmClipmapCascadeMap(clipmap, now.level, first + k, wpoInvalidates)
      if (levels[k] !== now.level) map.dropPages()
      levels[k] = now.level
    }
    if (!shadows.shadowCsmCaching) continue
    let records = held.get(lane.entry)
    if (!records) held.set(lane.entry, (records = []))
    const dropped = planCascadeCaches(
      settings,
      records,
      nowPool,
      { direction: clipmap.lightDirection, rotation: clipmap.lightViewRotation },
      rootsOf(rt),
      n,
    )
    for (const cascade of dropped) lane.entry.mapCaches[first + cascade]?.dropPages()
  }
}
