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
import {
  addVsmLocalLightShadow,
  vsmLocalViewData,
  type VsmLocalLightInput,
  type VsmLocalLightSetup,
} from './localLight.ts'
import type { VsmLightCache } from './cacheManager.ts'
import type { VsmMapIds } from './mapIds.ts'
import type { VsmFrameState } from './frameState.ts'
import type { VsmFrameLight, VsmLightAllocation } from './frameSetup.ts'

// The frame's suns and their clipmaps, its local lights and their setups, side by side.
const suns: SceneLight[] = []
const clipmaps: VsmClipmap[] = []
const locals: SceneLight[] = []
const setups: VsmLocalLightSetup[] = []
// The plan's lights, rebuilt in place: a plan lives until its frame ends. Its records are held
// across frames (`allocationRecords`), each rewritten whole when a light takes it.
const allocationScratch: VsmLightAllocation[] = []
const allocationRecords: VsmLightAllocation[] = []
const lightIds = { ids: undefined as unknown as VsmMapIds, allocations: allocationScratch }
// The local lights' input and views, rewritten for each light: the setup keeps neither.
const localViews: ReturnType<typeof vsmLocalViewData>[] = []
const localInput: VsmLocalLightInput = { id: '', kind: 'point', position: [], range: 0 }

/** The frame's next allocation record, rewritten whole. */
function allocation(
  light: SceneLight,
  entry: VsmLightCache,
  singlePage: boolean,
  shouldRender: boolean,
  clipmap: VsmClipmap | undefined,
  local: VsmLocalLightSetup | undefined,
) {
  const record = (allocationRecords[allocationScratch.length] ??= {} as VsmLightAllocation)
  record.id = light.id
  record.kind = light.kind
  record.firstId = entry.mapId
  record.count = entry.mapCaches.length
  record.singlePage = singlePage
  record.shouldRender = shouldRender
  record.entry = entry
  record.clipmap = clipmap
  record.local = local
  allocationScratch.push(record)
}

/** The directional lights' shadows: one clipmap each, into `suns` and `clipmaps`. */
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
    suns.push(light)
    clipmaps.push(clipmap)
  }
}

/** The local lights' shadows: one setup each, into `locals` and `setups`; the views made once a frame
 *  that has one. */
function setupLocalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  localViews.length = 0
  for (const { light } of casting) {
    if ((light.kind !== 'point' && light.kind !== 'spot') || !light.position || !light.range)
      continue
    if (!localViews.length) localViews.push(vsmLocalViewData(camera, viewport))
    const input = localInput
    input.id = light.id
    input.kind = light.kind
    input.position = light.position
    input.direction = light.direction
    input.range = light.range
    input.coneAngle = light.coneAngle
    input.innerConeAngle =
      light.coneAngle !== undefined ? light.coneAngle * (1 - (light.penumbra ?? 1)) : undefined
    input.sourceRadius = light.emitterRadius
    const setup = addVsmLocalLightShadow(state.cache, input, localViews, mobilityOf(light.id))
    locals.push(light)
    setups.push(setup)
  }
}

/** The id allocation: directional, local, then unreferenced entries. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset()
  allocationScratch.length = 0
  for (let i = 0; i < suns.length; i++) {
    const entry = clipmaps[i].cacheEntry
    entry.moveToMapId(ids.allocateDirectional(entry.mapCaches.length))
    allocation(suns[i], entry, false, true, clipmaps[i], undefined)
  }
  for (let i = 0; i < locals.length; i++) {
    const setup = setups[i],
      entry = setup.cacheEntry
    entry.moveToMapId(ids.allocateLocal(entry.isCachedFarLight(), entry.mapCaches.length))
    allocation(locals[i], entry, entry.isCachedFarLight(), setup.drawsThisFrame, undefined, setup)
  }
  state.cache.carryUnseenLights(ids)
  lightIds.ids = ids
  return lightIds
}

/** The casting lights' maps set up and given their ids: the allocator, and where each landed. */
export function allocateFrameLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
  mobilityOf: (id: string) => number,
) {
  suns.length = clipmaps.length = locals.length = setups.length = 0
  setupDirectionalLights(state, casting, camera, viewport)
  setupLocalLights(state, casting, camera, viewport, mobilityOf)
  return allocateLightIds(state)
}
