/**
 * WHAT A SET'S PROJECTION HOLDS (`projectionPass.ts`): its view uniform, its groups and the bytes they take, made before
 * the frame's lists and freed with the set; and the engine's blue noise it reads, the device's, never freed with a set.
 */
import { heldGroup, type HeldGroup } from '../../../../gpu/bind/bindIdentity.ts'
import { blueNoiseNow } from '../../../../gpu/noise/blueNoiseTextures.ts'
import { VSM_PROJECTION_VIEW_BYTES } from './projectionView.ts'
import { vsmFrameSetHeld, type VsmPerFrameSet, type VsmResources } from '../resources.ts'
import type { ViewWords } from './projectionViewWrite.ts'
import type { PerLightLights } from './perLightPass.ts'
import type { VsmVisualizeRequest } from './visualizePass.ts'
import { sizedBuffer } from '../../../../gpu/core/sizedBuffer.ts'
import { uniformBuffer } from '../../../../gpu/core/uniformBlock.ts'

/** What a set's projection holds (`vsmProjectionReserve`), freed with the set
 *  (`releaseVsmProjection`): never shared by two sessions on one device. The engine projects its
 *  opaque surfaces into its mask each frame: one view uniform, and a pass group. */
export interface VsmProjectionState {
  uniform?: GPUBuffer
  /** Group 0 over the tables of a frame set and the layout (`vsmPerFrameSet`), the two sets in
   *  turn. */
  tables: VsmPerFrameSet<GPUBindGroup>
  /** The suns' and the local lights' pass groups over their layouts and the frame's views
   *  (`passGroupFor`). */
  suns: HeldGroup
  locals: HeldGroup
  /** The view uniform's image, uploaded each frame, and its words. */
  staging: ArrayBuffer
  words: ViewWords
  /** The collection number of the toon extinctions the view uniform holds (`registeredToonProfiles`), none before they were uploaded. */
  toonRevision?: number
  /** The engine's blue noise view (`blueNoiseNow`), once the device has made it. */
  blueNoiseView?: GPUTextureView
  /** The shadowed lights' grid (`lightGridWgsl.ts`) the local lights' pass writes and the lighting
   *  reads, as long as the light grid's view part at least. */
  lightGrid?: GPUBuffer
  /** What the per-light path holds (`perLightPass.ts`), made at the first frame that takes it. */
  perLight?: VsmPerLightState
  /** What the virtual shadow map views hold (`visualizePass.ts`), made at the first frame a view is on. */
  visualize?: VsmVisualizeState
  /** What the single-layer water's sun projection holds (`waterSunProjection.ts`), made at the first frame that takes it. */
  water?: VsmWaterProjectionState
}

/** What a set's virtual shadow map views hold: the colour targets (the suns' sum, then the lights'), the words of the view, and the targets' size. */
export interface VsmVisualizeState {
  suns?: GPUTexture
  locals?: GPUTexture
  params: GPUBuffer
  width: number
  height: number
  /** The target the screen pass draws this frame with the request it was made for; none while no view ran. */
  result?: { view: GPUTextureView; request: VsmVisualizeRequest }
}

/** The single-layer water's sun projection's mask, a layer a sun of the frame at the target's size, and its pass group. */
interface VsmWaterProjectionState {
  mask?: GPUTexture
  view?: GPUTextureView
  group: HeldGroup
}

/** What the per-light path holds (`vsmPerLightState`): its records, their group and the frame's lights while the
 *  frame takes the path. Its mask is the set's (`VsmMask.perLight`, `../frame/vsmMask.ts`). */
interface VsmPerLightState {
  /** The lights' records (`perLightRecord.ts`), the words they are uploaded from and the same words as the integers the
   *  rectangles are written in. */
  records?: GPUBuffer
  words: Uint32Array<ArrayBuffer>
  ints: Int32Array<ArrayBuffer>
  /** The byte offset of each record, which the dispatch and the draw bind at. */
  offsets: Uint32Array<ArrayBuffer>
  /** The projection's group. */
  projection: HeldGroup
  /** This frame's lights (`beginPerLightFrame`); none while the frame takes the one-pass path. */
  frame?: PerLightLights
}

/** Bytes the projection of `res` holds — its view uniform and its shadowed lights' grid —, which
 *  freeing the set gives back (`releaseVsmProjection`; the pass draws into the engine's mask). */
export const vsmProjectionHeldBytes = (res: VsmResources) =>
  (res.projection?.uniform ? VSM_PROJECTION_VIEW_BYTES : 0) +
  (res.projection?.lightGrid?.size ?? 0) +
  perLightHeldBytes(res.projection?.perLight) +
  waterHeldBytes(res.projection?.water)

/** Bytes the projection of `res` still asks — its view uniform, where it holds none —; of a set not
 *  made yet, all of it. */
export const vsmProjectionBytesToMake = (res: VsmResources | undefined) =>
  res?.projection?.uniform ? 0 : VSM_PROJECTION_VIEW_BYTES

/** Makes the projection view uniform of `res`, where it holds none, and takes the device's blue noise
 *  once it is made (`blueNoiseView` is none before it: `projectionReady`): before the frame's lists,
 *  so that they never take the room they need. */
export function vsmProjectionReserve(device: GPUDevice, res: VsmResources) {
  const state = projectionState(res)
  state.uniform ??= uniformBuffer(device, 'vsm.projection.view', VSM_PROJECTION_VIEW_BYTES)
  state.blueNoiseView ??= blueNoiseNow(device)?.view
  return state
}

/** The shadowed lights' grid of `state` for a light grid whose view part takes `words` words, grown by the
 *  engine's one rule (`sizedBuffer`). */
export const vsmLightGridFor = (device: GPUDevice, state: VsmProjectionState, words: number) =>
  (state.lightGrid = sizedBuffer(
    device,
    state.lightGrid,
    words * 4,
    GPUBufferUsage.STORAGE,
    'vsm.projection.lightGrid',
  ))

/** Whether the projection of `state` can run: the engine's blue noise is made. */
export const projectionReady = (state: VsmProjectionState) => !!state.blueNoiseView

/** The view uniform and the blue noise the projection of `res` reads: what a blended surface's
 *  trace reads too (`vsmTraceFactor`), the same view and noise. None before the set's
 *  first reservation. */
export function vsmProjectionShared(res: VsmResources) {
  const state = res.projection
  return state?.uniform && state.blueNoiseView
    ? { view: state.uniform, noise: state.blueNoiseView }
    : undefined
}

/** Frees what the projection of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmProjection(res: VsmResources) {
  const state = res.projection
  if (!state) return
  res.projection = undefined
  state.uniform?.destroy()
  state.lightGrid?.destroy()
  releasePerLight(state.perLight)
  state.water?.mask?.destroy()
  state.water = undefined
  state.visualize?.suns?.destroy()
  state.visualize?.locals?.destroy()
  state.visualize?.params.destroy()
}

/** The water's sun projection state of `state`, made at its first ask. */
export const vsmWaterState = (state: VsmProjectionState) => (state.water ??= { group: heldGroup() })

function projectionState(res: VsmResources) {
  if (res.projection) return res.projection
  const staging = new ArrayBuffer(VSM_PROJECTION_VIEW_BYTES)
  return (res.projection = {
    staging,
    tables: vsmFrameSetHeld(),
    suns: heldGroup(),
    locals: heldGroup(),
    words: {
      f: new Float32Array(staging),
      u: new Uint32Array(staging),
      i: new Int32Array(staging),
    },
  })
}

/** Bytes the water's sun mask holds. */
const waterHeldBytes = (held: VsmWaterProjectionState | undefined) =>
  held?.mask ? held.mask.width * held.mask.height * held.mask.depthOrArrayLayers * 4 : 0

/** Bytes the per-light path of a projection holds: its records. */
const perLightHeldBytes = (held: VsmPerLightState | undefined) => held?.records?.size ?? 0

/** The per-light state of `state`, made at its first ask. */
export const vsmPerLightState = (state: VsmProjectionState) =>
  (state.perLight ??= {
    words: new Uint32Array(0),
    ints: new Int32Array(0),
    offsets: new Uint32Array(0),
    projection: heldGroup(),
  })

/** Frees what the per-light path holds. */
function releasePerLight(held: VsmPerLightState | undefined) {
  held?.records?.destroy()
}
