import type { EngineVsm } from '../render/vsm/engineVsm.ts'
import type { VsmRefusal } from '../render/vsm/vsmGrant.ts'
import { vsmUnsettled } from './vsmSettle.ts'
import { createSceneLightStore, type SceneLightStore } from '../../../../../sdk-core/src/index.ts'
import {
  SHADOW_CHANGE_BOXES,
  createShadowChanges,
} from '../../../../../sdk-core/src/scene/light-shadow/changes.ts'
import type { GpuLightTiles } from '../../../lighting/tiles/tiles.ts'
import { createShadowResidence } from '../../shadow/residence.ts'
import { createShadowMobility, type ShadowMobility } from '../../shadow/mobility.ts'
import type { ShadowRowLods } from '../../shadow/rowLods.ts'
import type { clusterSpheres } from '../../shadow/rowBuffers.ts'
import { createShadowMemory, type ShadowMemory } from '../../shadow/memoryGrant.ts'

/** Direct lighting: the light store (the host's too), tile lists, and what the virtual shadow maps
 *  read of the engine — the world's change boxes, the caster rows' spheres, mobility and detail. */
export interface WebgpuLightState {
  store: SceneLightStore
  /** What moved in the world since the last frame, as boxes the virtual shadow maps' invalidation
   *  reads, then consumes (`../render/vsm/vsmPlan.ts`). */
  changes: ReturnType<typeof createShadowChanges>
  buffer: GPUBuffer | undefined
  tiles: GpuLightTiles | undefined
  /** Group 0's layout of the shadow raster: the page rows, as the visibility pass binds them, less
   *  what the raster never reads (`../../shadow/pageGroup.ts`); absent while shadows are off. */
  pageLayout: GPUBindGroupLayout | undefined
  /** Residency flips, compared frame to frame (`../../shadow/residence.ts`). */
  residence: ReturnType<typeof createShadowResidence>
  /** Which placements move: the static or dynamic cache a caster's pages are drawn in. */
  mobility: ShadowMobility
  mobilityRows: GPUBuffer | undefined // a word per row, what the raster splits its casters by
  rowLods: ShadowRowLods | undefined // each caster row's detail, its level chosen per page (#831)
  spheres: ReturnType<typeof clusterSpheres> | undefined
  /** Whether the caster rows' spheres, mobility words and detail followed every change of the row
   *  table since a light last cast: false while none casts, when they are neither made nor written
   *  (`../render/encodeDraws.ts`). */
  rowsFollowed: boolean
  uploadedEpoch: number // store revision already pushed: an image with no change writes nothing
  /** Contract lights kept by the last image. */
  lightsActive: number
  shadowReason: string | null // why shadows are off, when they are
  /** The shadows' memory pressure events and resolution bias (`../../shadow/memoryGrant.ts`). */
  memory: ShadowMemory
  firstFrameLogged: boolean // the first contract-lit image's configuration is logged once
  /** The virtual shadow maps (`../render/vsm/engineVsm.ts`), made at the first lit frame. */
  vsm?: EngineVsm
  /** Why the last set asked was not made, until one is (`../render/vsm/vsmGrant.ts`). */
  vsmRefusal?: VsmRefusal
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
    rowsFollowed: false,
    uploadedEpoch: 0,
    lightsActive: 0,
    shadowReason: null,
    memory: createShadowMemory(),
    firstFrameLogged: false,
  }
}

/**
 * True while the shadows can still change what the image shows: a representation change held for
 * the camera to rest, or the virtual shadow maps still drawing, by their own state
 * (`vsmSettle.ts`). A scene without a shadow light, or an unlit view, waits for no map.
 */
export function shadowsUnsettled(lights: WebgpuLightState) {
  const { changes, store, vsm } = lights
  if (changes.deferred()) return true
  // The virtual shadow maps: pages drawn, invalidated or uncached since the last count read back,
  // the budget feedback moving the resolution, the transmission pool short (`vsmSettle.ts`).
  return (
    !!vsm &&
    !!store.count &&
    !store.unlit &&
    vsmUnsettled(vsm.settle, vsm.countersOn, !!vsm.transmission?.wanted)
  )
}
