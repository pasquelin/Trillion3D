import type { EngineVsm } from '../../../lighting/shadows/vsm/frame/engineVsm.ts'
import type { VsmRefusal } from '../../../lighting/shadows/vsm/frame/vsmGrant.ts'
import { vsmUnsettled } from './vsmSettle.ts'
import {
  createSceneLightStore,
  type SceneLightStore,
} from '../../../../../sdk-core/src/scene/light/store.ts'
import {
  SHADOW_CHANGE_BOXES,
  createShadowChanges,
} from '../../../../../sdk-core/src/scene/light/shadow/changes.ts'
import type { GpuLightTiles } from '../../../lighting/tiles/tiles.ts'
import type { LightFunctionFrame } from '../../../lighting/lightFunction/frame.ts'
import { createShadowResidence } from '../../../lighting/shadows/casters/residence.ts'
import {
  createShadowMobility,
  type ShadowMobility,
} from '../../../lighting/shadows/casters/mobility.ts'
import type { ShadowRowLods } from '../../../lighting/shadows/casters/rowLods.ts'
import type { MobilitySource } from '../../../lighting/shadows/casters/bounds.ts'
import type { VsmFrameLight } from '../../../lighting/shadows/vsm/frameSetup.ts'
import type { clusterSpheres } from '../../../lighting/shadows/casters/rowBuffers.ts'
import type { CastChanges } from '../../../lighting/shadows/casters/castChanges.ts'
import type { RowWords } from '../../../placement/rows/rowWords.ts'
import {
  createShadowMemory,
  type ShadowMemory,
} from '../../../lighting/shadows/casters/memoryGrant.ts'

/** Direct lighting: the light store (the host's too), tile lists, and what the virtual shadow maps
 *  read of the engine — the world's change boxes, the caster rows' spheres, mobility and detail. */
export interface WebgpuLightState {
  store: SceneLightStore
  /** What moved in the world since the last frame, as boxes the virtual shadow maps' invalidation
   *  reads, then consumes (`../../../lighting/shadows/vsm/frame/vsmPlan.ts`). */
  changes: ReturnType<typeof createShadowChanges>
  buffer: GPUBuffer | undefined
  tiles: GpuLightTiles | undefined
  /** The light functions' atlas, plan and table, made when a light wears one
   *  (`../../../lighting/lightFunction/frame.ts`). */
  lightFunction?: LightFunctionFrame
  /** Group 0's layout of the shadow raster: the page rows, as the visibility pass binds them, less
   *  what the raster never reads (`../../../lighting/shadows/casters/pageGroup.ts`); absent while shadows are off. */
  pageLayout: GPUBindGroupLayout | undefined
  /** Residency flips, compared frame to frame (`../../../lighting/shadows/casters/residence.ts`). */
  residence: ReturnType<typeof createShadowResidence>
  /** Which placements move: the static or dynamic cache a caster's pages are drawn in. */
  mobility: ShadowMobility
  mobilityRows: GPUBuffer | undefined // a word per row, what the raster splits its casters by
  rowLods: ShadowRowLods | undefined // each caster row's detail, its level chosen per page
  spheres: ReturnType<typeof clusterSpheres> | undefined
  /** The rows' shadow changes the rows pass appends and the invalidation reads, made with the
   *  spheres (`../../../lighting/shadows/casters/castChanges.ts`). */
  casts: CastChanges | undefined
  /** Whether the caster rows' spheres, mobility words and detail followed every change of the row
   *  table since a light last cast: false while none casts, when they are neither made nor written
   *  (`../../render/encodeDraws.ts`). */
  rowsFollowed: boolean
  uploadedEpoch: number // store revision already pushed: an image with no change writes nothing
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
  /** The physical pages the sets' fill asked so far, past the view's own (`vsmPoolAsked`); never
   *  lowered: no frame flips between two pools. */
  vsmPoolDemand: number
  /** The store's lights as the shadow maps read them, rewritten in place: the plan's, and the
   *  reserve's (`vsmReserveBytes`), apart so that neither rewrites the other's while it is read
   *  (`../../../lighting/shadows/vsm/frame/vsmPlan.ts`). */
  vsmLights?: { plan: VsmFrameLight[]; reserve: VsmFrameLight[] }
  /** What the caster rows' mobility words are written from (`../../../lighting/shadows/casters/bounds.ts`), built once
   *  for the session. */
  mobilitySource?: MobilitySource
}

export function createWebgpuLightState(store?: SceneLightStore): WebgpuLightState {
  return {
    store: store ?? createSceneLightStore(),
    changes: createShadowChanges(SHADOW_CHANGE_BOXES),
    buffer: undefined,
    tiles: undefined,
    pageLayout: undefined,
    residence: createShadowResidence(),
    mobility: createShadowMobility(),
    mobilityRows: undefined,
    rowLods: undefined,
    spheres: undefined,
    casts: undefined,
    rowsFollowed: false,
    uploadedEpoch: 0,
    lightsActive: 0,
    shadowReason: null,
    memory: createShadowMemory(),
    firstFrameLogged: false,
    vsmPoolDemand: 0,
  }
}

/**
 * True while the shadows can still change what the image shows: a representation change held for
 * the camera to rest, rows named for a shadow change the rows pass has not staled yet (`stales`,
 * `../../../placement/rows/rowTargets.ts`), or the virtual shadow maps still drawing, by their own state
 * (`vsmSettle.ts`). A scene without a shadow light, or an unlit view, waits for no map.
 */
export function shadowsUnsettled(
  lights: WebgpuLightState,
  rowWords: Pick<RowWords, 'stales'> | undefined,
) {
  const { changes, store, vsm } = lights
  if (changes.deferred() || !!rowWords?.stales) return true
  // The virtual shadow maps: pages drawn, invalidated or uncached since the last count read back,
  // the budget feedback moving the resolution, the transmission pool short (`vsmSettle.ts`).
  return (
    !!vsm &&
    !!store.count &&
    !store.unlit &&
    vsmUnsettled(vsm.settle, vsm.countersOn, !!vsm.transmission?.wanted)
  )
}
