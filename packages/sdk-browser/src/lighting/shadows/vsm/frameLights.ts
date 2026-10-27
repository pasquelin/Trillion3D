/**
 * THE FRAME'S CASTING LIGHTS SET UP AND GIVEN THEIR IDS (`frameSetup.ts`): a clipmap a sun, a setup
 * a local light, then the ids by run of maps (`mapIds.ts`), the cache entries no light referenced
 * after the lights of their run. The ids are claimed here and taken by the entries once the plan is
 * kept (`commitVirtualShadowFrame`).
 */
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import {
  innerConeAngleOf,
  lightingChannelMaskOf,
  mobilityOf,
  spotConesOf,
} from '../../../../../sdk-core/src/scene/light/fields.ts'
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
const spotInput = { ...common, kind: 'spot' as const, direction: axis, outerCone: 0, innerCone: 0 }
const rectInput = { ...common, kind: 'rect' as const, direction: axis, right: axis }

/** The frame's next allocation record, rewritten whole. */
function allocation(
  ids: VsmMapIds,
  light: SceneLight,
  entry: VsmLightCache,
  clipmap: VsmClipmap | undefined,
  local: VsmLocalLightSetup | undefined,
) {
  const record = (allocationRecords[allocationScratch.length] ??= {} as VsmLightAllocation)
  record.id = light.id
  record.kind = light.kind
  record.channels = lightingChannelMaskOf(light)
  record.firstId = ids.firstIdOf(entry)
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
  for (const { light, cascades } of casting) {
    if (light.kind !== 'directional' || !light.direction) continue
    const clipmap = createVsmClipmap(
      state.cache,
      {
        ...{
          id: light.id,
          direction: light.direction,
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
      const own = { id: light.id, direction: light.direction }
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
  input.softSourceRadius = light.emitterSoftRadius
  input.sourceLength = light.emitterLength
  if (input.kind === 'spot') {
    input.direction = light.direction!
    input.outerCone = spotConesOf(light)[1]
    input.innerCone = innerConeAngleOf(light)
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
  for (const { light } of casting) {
    if (light.kind === 'directional' || !light.position || !light.range) continue
    if (!localViews.length) localViews.push(vsmLocalViewData(camera, viewport))
    const setup = addVsmLocalLightShadow(state.cache, localInputOf(light), localViews, state.maps)
    locals.push(light)
    setups.push(setup)
  }
}

/** The id claims, by run of maps (`mapIds.ts`): the suns' clipmaps, the local lights' maps, the entries
 *  no light referenced; and the plan's records, which keep the lights' order, with where each light's
 *  maps landed. */
function allocateLightIds(state: VsmFrameState) {
  const ids = state.ids.reset()
  for (const { cacheEntry } of clipmaps) ids.claim(cacheEntry, 'sun')
  for (const { cacheEntry } of setups) ids.claim(cacheEntry, 'light')
  state.cache.claimUnseenLights(ids)
  ids.seal()
  allocationScratch.length = 0
  for (let i = 0; i < suns.length; i++)
    allocation(ids, suns[i], clipmaps[i].cacheEntry, clipmaps[i], undefined)
  for (let i = 0; i < locals.length; i++)
    allocation(ids, locals[i], setups[i].cacheEntry, undefined, setups[i])
  lightIds.ids = ids
  return lightIds
}

/** The casting lights' maps set up and their ids claimed: the allocator, and where each landed. */
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
