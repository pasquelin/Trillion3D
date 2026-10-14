/**
 * THE FRAME'S CASTING LIGHTS SET UP AND GIVEN THEIR IDS (`frameSetup.ts`): a clipmap a sun, a setup
 * a local light, then the ids — directional first, then local, then the cache entries no light
 * referenced.
 */
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import {
  createVsmClipmap,
  type VsmCameraInput,
  type VsmClipmap,
  type VsmViewport,
} from './clipmap.ts'
import { addVsmLocalLightShadow, vsmLocalViewData, type VsmLocalLightSetup } from './localLight.ts'
import type { VsmFrameState } from './frameState.ts'
import type { VsmFrameLight, VsmLightAllocation } from './frameSetup.ts'

const clipmapScratch: { light: SceneLight; clipmap: VsmClipmap }[] = []
const localScratch: { light: SceneLight; setup: VsmLocalLightSetup }[] = []
// The plan's lights, rebuilt in place: a plan lives until its frame ends.
const allocationScratch: VsmLightAllocation[] = []

/** The directional lights' shadows: one clipmap each, into `clipmaps`. */
function setupDirectionalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
) {
  for (const { light } of casting) {
    if (light.kind !== 'directional' || !light.direction) continue
    const clipmap = createVsmClipmap(
      state.cache,
      { id: light.id, direction: light.direction },
      camera,
      viewport,
    )
    clipmapScratch.push({ light, clipmap })
  }
}

/** The local lights' shadows: one setup each, into `locals`. */
function setupLocalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  const views = [vsmLocalViewData(camera, viewport)]
  for (const { light } of casting) {
    if ((light.kind !== 'point' && light.kind !== 'spot') || !light.position || !light.range)
      continue
    const setup = addVsmLocalLightShadow(
      state.cache,
      {
        id: light.id,
        kind: light.kind,
        position: light.position,
        direction: light.direction,
        range: light.range,
        coneAngle: light.coneAngle,
        innerConeAngle:
          light.coneAngle !== undefined ? light.coneAngle * (1 - (light.penumbra ?? 1)) : undefined,
        sourceRadius: light.emitterRadius,
      },
      views,
      mobilityOf(light.id),
    )
    localScratch.push({ light, setup })
  }
}

/** The id allocation: directional, local, then unreferenced entries. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset()
  const allocations = allocationScratch
  allocations.length = 0
  for (const { light, clipmap } of clipmapScratch) {
    const entry = clipmap.cacheEntry
    entry.moveToMapId(ids.allocateDirectional(entry.mapCaches.length))
    allocations.push({
      id: light.id,
      kind: light.kind,
      firstId: entry.mapId,
      count: entry.mapCaches.length,
      singlePage: false,
      shouldRender: true,
      entry,
      clipmap,
    })
  }
  for (const { light, setup } of localScratch) {
    const entry = setup.cacheEntry
    entry.moveToMapId(ids.allocateLocal(entry.isCachedFarLight(), entry.mapCaches.length))
    allocations.push({
      id: light.id,
      kind: light.kind,
      firstId: entry.mapId,
      count: entry.mapCaches.length,
      singlePage: entry.isCachedFarLight(),
      shouldRender: setup.drawsThisFrame,
      entry,
      local: setup,
    })
  }
  state.cache.carryUnseenLights(ids)
  return { ids, allocations }
}

/** The casting lights' maps set up and given their ids: the allocator, and where each landed. */
export function allocateFrameLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  clipmapScratch.length = 0
  localScratch.length = 0
  setupDirectionalLights(state, casting, camera, viewport)
  setupLocalLights(state, casting, camera, viewport, mobilityOf)
  return allocateLightIds(state)
}
