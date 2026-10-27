/**
 * THE FRAME'S CASTING LIGHTS SET UP AND GIVEN THEIR IDS (`frameSetup.ts`): a clipmap a sun, a setup
 * a local light, then the ids — directional first, then local, then the cache entries no light
 * referenced.
 */
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { mobilityOf, spotConesOf } from '../../../../../sdk-core/src/scene/light/fields.ts'
import { shadowOfLight } from '../../../../../sdk-core/src/scene/light/lightShadow.ts'
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
import type { VsmLightCache } from './lightCache.ts'
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
// The local lights' input and views, rewritten for each light: the setup keeps neither. One input a
// kind, each holding what its kind's maps are cut by.
const localViews: ReturnType<typeof vsmLocalViewData>[] = []
const common = { id: '', position: [] as ArrayLike<number>, range: 0, movable: false }
const pointInput = { ...common, kind: 'point' as const }
const axis = [] as ArrayLike<number>
const spotInput = { ...common, kind: 'spot' as const, direction: axis, outerCone: 0 }
const rectInput = { ...common, kind: 'rect' as const, direction: axis, right: axis }
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
  record.firstPerson = clipmap?.light.firstPerson === true
  allocationScratch.push(record)
}

/** The directional lights' shadows: one clipmap each, into `suns` and `clipmaps`. */
function setupDirectionalLights(
  state: VsmFrameState,
  casting: readonly VsmFrameLight[],
  camera: VsmCameraInput,
  viewport: VsmViewport,
) {
  for (const { light, farShadowEdge, cascades } of casting) {
    if (light.kind !== 'directional' || !light.direction) continue
    const clipmap = createVsmClipmap(
      state.cache,
      {
        ...{
          id: light.id,
          direction: light.direction,
          farShadowEdge,
          cascades,
          movable: mobilityOf(light) === 'movable',
        },
        shadow: shadowOfLight(light),
      },
      camera,
      viewport,
      state.maps,
    )
    suns.push(light)
    clipmaps.push(clipmap)
    // The sun's second clipmap, for the objects that stand for a first-person one (`firstPerson`).
    if (state.maps.firstPerson?.active) {
      const own = { id: light.id, direction: light.direction, farShadowEdge }
      suns.push(light)
      clipmaps.push(
        createVsmClipmap(
          state.cache,
          { ...own, cascades, shadow: shadowOfLight(light), firstPerson: true },
          camera,
          viewport,
          state.maps,
        ),
      )
    }
  }
}

/** `light` as its kind's setup input, rewritten in place: a spot's map is as wide as the outer cone it
 *  is lit by. */
function localInputOf(light: SceneLight): VsmLocalLightInput {
  const input: VsmLocalLightInput =
    light.kind === 'spot' ? spotInput : light.kind === 'rect' ? rectInput : pointInput
  input.id = light.id
  input.position = light.position!
  input.range = light.range!
  input.movable = mobilityOf(light) === 'movable'
  input.sourceRadius = light.emitterRadius
  if (input.kind === 'spot') {
    input.direction = light.direction!
    input.outerCone = spotConesOf(light)[1]
  } else if (input.kind === 'rect') {
    input.direction = light.direction!
    input.right = light.right!
  }
  return input
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
  for (const { light } of casting) nearFirst.push(light)
  const eye = camera.eye
  const distanceSq = (l: SceneLight) => {
    const p = l.position ?? eye
    return (p[0] - eye[0]) ** 2 + (p[1] - eye[1]) ** 2 + (p[2] - eye[2]) ** 2
  }
  nearFirst.sort((a, b) => distanceSq(a) - distanceSq(b))
  for (const light of nearFirst) {
    if (light.kind === 'directional' || !light.position || !light.range) continue
    if (!localViews.length) localViews.push(vsmLocalViewData(camera, viewport))
    const setup = addVsmLocalLightShadow(state.cache, localInputOf(light), localViews, state.maps)
    locals.push(light)
    setups.push(setup)
  }
}

/** The id allocation: directional, local, then unreferenced entries, within the set's map slots: a
 *  light past them — the farthest, the local lights coming nearest first — casts no shadow this
 *  frame, its entry dropped and its maps counted (`refusedMaps`) for the slots to grow; the others keep theirs. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset(state.resources.layout.mapSlots)
  allocationScratch.length = 0
  for (let i = 0; i < suns.length; i++) {
    const entry = clipmaps[i].cacheEntry
    if (!ids.fits(entry.mapCaches.length)) {
      ids.refuse(entry.mapCaches.length)
      state.cache.entries.delete(entry.key)
      continue
    }
    entry.moveToMapId(ids.allocateDirectional(entry.mapCaches.length))
    allocation(suns[i], entry, clipmaps[i], undefined)
  }
  for (let i = 0; i < locals.length; i++) {
    const setup = setups[i],
      entry = setup.cacheEntry
    if (!ids.fits(entry.mapCaches.length)) {
      ids.refuse(entry.mapCaches.length)
      state.cache.entries.delete(entry.key)
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
