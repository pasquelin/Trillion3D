import type { EngineVsm } from '../../../lighting/shadows/vsm/frame/engineVsm.ts'
import type { VsmRefusal } from '../../../lighting/shadows/vsm/frame/vsmGrant.ts'
import { vsmArrived, vsmUnsettled } from './vsmSettle.ts'
import {
  createSceneLightStore,
  type SceneLightStore,
} from '../../../../../sdk-core/src/scene/light/store.ts'
import {
  SHADOW_CHANGE_BOXES,
  createShadowChanges,
} from '../../../../../sdk-core/src/scene/light/shadow/changes.ts'
import type { GpuLightTiles } from '../../../lighting/tiles/tiles.ts'
import { createDrawnLights, type DrawnLights } from '../../../lighting/lightDrawRange.ts'
import type { LightFunctionFrame } from '../../../lighting/lightFunction/frame.ts'
import type { LightProfileFrame } from '../../../lighting/lightProfile/frame.ts'
import type { RectLightAtlasFrame } from '../../../lighting/rectLightAtlas/frame.ts'
import type { AmbientCubemapFrame } from '../../../lighting/deferred/ambientCubemapFrame.ts'
import {
  createShadowMobility,
  type ShadowMobility,
} from '../../../lighting/shadows/casters/mobility.ts'
import type { RootWordsSource } from '../../../lighting/shadows/casters/rootWords.ts'
import type { CasterFeed } from '../../../lighting/shadows/casters/casterFeed.ts'
import type { VsmFrameLight } from '../../../lighting/shadows/vsm/frameSetup.ts'
import type { CastChanges } from '../../../lighting/shadows/casters/castChanges.ts'
import {
  createShadowMemory,
  type ShadowMemory,
} from '../../../lighting/shadows/casters/memoryGrant.ts'

/** Direct lighting: the light store (the host's too), tile lists, and what the virtual shadow maps
 *  read of the engine — the world's change boxes, the placements' words
 *  and the casters. */
export interface WebgpuLightState {
  store: SceneLightStore
  /** What moved in the world since the last frame, as boxes the virtual shadow maps' invalidation
   *  reads, then consumes (`../../../lighting/shadows/vsm/frame/vsmPlan.ts`). */
  changes: ReturnType<typeof createShadowChanges>
  buffer: GPUBuffer | undefined
  /** The ranks of the directional lights in `buffer`, after their count: what the sun's pass walks
   *  (`createSunRanksBuffer`, `lightBuffer.ts`). Made and replaced with `buffer`. */
  sunRanks: GPUBuffer | undefined
  tiles: GpuLightTiles | undefined
  /** The light functions' atlas, plan and table, made when a light wears one
   *  (`../../../lighting/lightFunction/frame.ts`). */
  lightFunction?: LightFunctionFrame
  /** The light profiles' atlas and the profiles read, made when a light names one
   *  (`../../../lighting/lightProfile/frame.ts`). */
  lightProfile?: LightProfileFrame
  /** The rectangle lights' source-texture atlas and the slot each textured light holds, made when a rect names a picture
   *  (`../../../lighting/rectLightAtlas/frame.ts`). */
  rectAtlas?: RectLightAtlasFrame
  /** The ambient cubemap's cube and colour, made when the image sets a cube
   *  (`../../../lighting/deferred/ambientCubemapFrame.ts`). */
  ambientCubemap?: AmbientCubemapFrame
  /** Group 0's layout of the shadow raster: the page rows, as the visibility pass binds them, less
   *  what the raster never reads (`../../../lighting/shadows/casters/pageGroup.ts`); absent while shadows are off. */
  pageLayout: GPUBindGroupLayout | undefined
  /** Which placements move: the static or dynamic cache a caster's pages are drawn in. */
  mobility: ShadowMobility
  /** A word per placement, what the raster splits its casters by and the diff of their boxes follows
   *  (`../../../lighting/shadows/casters/rootWords.ts`). */
  rootWords: GPUBuffer | undefined
  /** The shadow changes the diff of the placements' boxes appends and the invalidation reads, and
   *  what the diff remembers of each placement (`../../../lighting/shadows/casters/castChanges.ts`). */
  casts: CastChanges | undefined
  /** The clusters that cast, listed and decoded for the raster each frame
   *  (`../../../lighting/shadows/casters/casterFeed.ts`). */
  casters: CasterFeed | undefined
  uploadedEpoch: number // store revision already pushed: an image with no change writes nothing
  /** What the view's draw range was last decided for, and the lights whose word changed (`drawLights`, `../../../lighting/lightDrawRange.ts`). */
  drawn: DrawnLights
  /** Contract lights kept by the last image. */
  lightsActive: number
  shadowReason: string | null // why shadows are off, when they are
  /** The shadows' memory pressure events and resolution bias (`../../../lighting/shadows/casters/memoryGrant.ts`). */
  memory: ShadowMemory
  firstFrameLogged: boolean // the first contract-lit image's configuration is logged once
  /** The virtual shadow maps (`../../../lighting/shadows/vsm/frame/engineVsm.ts`), made at the first lit frame. */
  vsm?: EngineVsm
  /** Why the last set asked was not made, until one is (`../../../lighting/shadows/vsm/frame/vsmGrant.ts`). */
  vsmRefusal?: VsmRefusal
  /** The store's lights as the shadow maps read them, rewritten in place: the plan's, and the
   *  reserve's (`vsmReserveBytes`), apart so that neither rewrites the other's while it is read
   *  (`../../../lighting/shadows/vsm/frame/vsmPlan.ts`). */
  vsmLights?: { plan: VsmFrameLight[]; reserve: VsmFrameLight[] }
  /** What the placements' words are written from (`../../../lighting/shadows/casters/rootWords.ts`),
   *  built once for the session. */
  mobilitySource?: RootWordsSource
}

export function createWebgpuLightState(store?: SceneLightStore): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    changes: createShadowChanges(SHADOW_CHANGE_BOXES),
    buffer: undefined,
    sunRanks: undefined,
    tiles: undefined,
    pageLayout: undefined,
    mobility: createShadowMobility(),
    rootWords: undefined,
    casts: undefined,
    casters: undefined,
    uploadedEpoch: 0,
    drawn: createDrawnLights(),
    lightsActive: 0,
    shadowReason: null,
    memory: createShadowMemory(),
    firstFrameLogged: false,
  }
}

/**
 * True while the shadows can still change what the image shows: the virtual shadow maps still
 * drawing, by their own state (`vsmSettle.ts`). A scene without a shadow light, or an unlit view,
 * waits for no map.
 */
export function shadowsUnsettled(lights: WebgpuLightState) {
  // The virtual shadow maps: pages drawn, invalidated or uncached since the last count read back,
  // the budget feedback moving the resolution (`vsmSettle.ts`).
  const vsm = mapsWaitedFor(lights)
  return !!vsm && vsmUnsettled(vsm.settle, vsm.countersOn)
}

/** True once the shadows have arrived (`vsmArrived`): the maps drawn as the image asks them,
 *  whatever casters that move keep redrawing. A scene without a shadow light, or an unlit view,
 *  waits for no map. */
export function shadowsArrived(lights: WebgpuLightState) {
  const vsm = mapsWaitedFor(lights)
  return !vsm || vsmArrived(vsm.settle, vsm.countersOn)
}

/** The virtual shadow maps the image waits for: none in a scene without a shadow light or an unlit view. */
const mapsWaitedFor = ({ store, vsm }: WebgpuLightState) =>
  vsm && store.count && !store.unlit ? vsm : undefined
