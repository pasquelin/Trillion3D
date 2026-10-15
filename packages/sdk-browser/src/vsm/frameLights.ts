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
/** The frame's shadowed local lights, nearest the eye first. */
const nearFirst: SceneLight[] = []

/** The frame's next allocation record, rewritten whole. */
function allocation(
  light: SceneLight,
  entry: VsmLightCache,
  clipmap: VsmClipmap | undefined,
  local: VsmLocalLightSetup | undefined,
) {
  const record = (allocationRecords[allocationScratch.length] ??= {} as VsmLightAllocation)
  record.id = light.id
  record.kind = light.kind
  record.firstId = entry.mapId
  record.count = entry.mapCaches.length
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
) {
  localViews.length = 0
  // Nearest the eye first: past the map slots, the farthest lights go (`allocateLightIds`).
  nearFirst.length = 0
  for (const { light } of casting)
    if ((light.kind === 'point' || light.kind === 'spot') && light.position && light.range)
      nearFirst.push(light)
  const eye = camera.eye
  const distanceSq = (l: SceneLight) =>
    (l.position![0] - eye[0]) ** 2 + (l.position![1] - eye[1]) ** 2 + (l.position![2] - eye[2]) ** 2
  nearFirst.sort((a, b) => distanceSq(a) - distanceSq(b))
  for (const light of nearFirst) {
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
    const setup = addVsmLocalLightShadow(state.cache, input, localViews)
    locals.push(light)
    setups.push(setup)
  }
}

/** The id allocation: directional, local, then unreferenced entries, within the set's map slots: a
 *  light past them — the farthest, the local lights coming nearest first — casts no shadow this
 *  frame, its entry dropped; the others keep theirs. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset(state.resources.layout.mapSlots)
  allocationScratch.length = 0
  for (let i = 0; i < suns.length; i++) {
    const entry = clipmaps[i].cacheEntry
    if (!ids.fits(entry.mapCaches.length)) {
      state.cache.entries.delete(entry.lightId)
      continue
    }
    entry.moveToMapId(ids.allocateDirectional(entry.mapCaches.length))
    allocation(suns[i], entry, clipmaps[i], undefined)
  }
  for (let i = 0; i < locals.length; i++) {
    const setup = setups[i],
      entry = setup.cacheEntry
    if (!ids.fits(entry.mapCaches.length)) {
      state.cache.entries.delete(entry.lightId)
      continue
    }
    entry.moveToMapId(ids.allocateLocal(entry.mapCaches.length))
    allocation(locals[i], entry, undefined, setup)
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
) {
  suns.length = clipmaps.length = locals.length = setups.length = 0
  setupDirectionalLights(state, casting, camera, viewport)
  setupLocalLights(state, casting, camera, viewport)
  return allocateLightIds(state)
}
