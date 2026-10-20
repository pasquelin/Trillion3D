/**
 * WHAT A SET'S PROJECTION HOLDS (`projectionPass.ts`): its view uniform, its blue noise, its groups
 * and the bytes they take, made before the frame's lists and freed with the set.
 */
import { heldGroup, type HeldGroup } from '../../../../gpu/bind/bindIdentity.ts'
import { createVsmBlueNoiseTexture, VSM_BLUE_NOISE_BYTES } from '../blueNoise.ts'
import { VSM_PROJECTION_VIEW_BYTES } from './projectionView.ts'
import { vsmFrameSetHeld, type VsmPerFrameSet, type VsmResources } from '../resources.ts'
import type { ViewWords } from './projectionViewWrite.ts'
import { VSM_PROJECTION_THROUGH_FORMAT } from './projectionWgsl.ts'
import { VSM_TRANSMISSION_FORMAT } from '../transmission/transmissionLayout.ts'
import { arrayView } from '../../../../gpu/core/textureViews.ts'
import { standInTexture } from '../../../../gpu/core/standInTexture.ts'

/** What a set's projection holds (`vsmProjectionReserve`), freed with the set
 *  (`releaseVsmProjection`): never shared by two sessions on one device. The engine projects its
 *  opaque surfaces into its mask each frame: one view uniform, and a pass group. */
export interface VsmProjectionState {
  uniform?: GPUBuffer
  /** Group 0 over the tables of a frame set and the layout (`vsmPerFrameSet`), the two sets in
   *  turn. */
  tables: VsmPerFrameSet<GPUBindGroup>
  /** The pass group over its layout and the frame's views (`passGroupFor`). */
  pass: HeldGroup
  /** The receiver group over its layout and view (`receiverGroupFor`): one kept, made again when
   *  one of them moved. */
  receiver: HeldGroup
  /** The view uniform's image, uploaded each frame, and its words. */
  staging: ArrayBuffer
  words: ViewWords
  /** The set's blue noise (`createVsmBlueNoiseTexture`) and its view. */
  blueNoise?: GPUTexture
  blueNoiseView?: GPUTextureView
  /** What a pass binds without translucent casters (`vsmProjectionStandIns`): a one-texel memory
   *  and a one-texel transmission target, which no pixel reads or writes. */
  noTransmission?: GPUTexture
  noThrough?: GPUTexture
  standIns?: { transmission: GPUTextureView; through: GPUTextureView }
}

/** Bytes the projection of `res` holds — its view uniform and blue noise —, which freeing the
 *  set gives back (`releaseVsmProjection`; the pass draws into the engine's mask). */
export const vsmProjectionHeldBytes = (res: VsmResources) => {
  const state = res.projection
  return (
    (state?.uniform ? VSM_PROJECTION_VIEW_BYTES : 0) + (state?.blueNoise ? VSM_BLUE_NOISE_BYTES : 0)
  )
}

/** Bytes the projection of `res` still asks — its view uniform and its blue noise, each where it
 *  holds none —; of a set not made yet, both. */
export const vsmProjectionBytesToMake = (res: VsmResources | undefined) =>
  VSM_PROJECTION_VIEW_BYTES + VSM_BLUE_NOISE_BYTES - (res ? vsmProjectionHeldBytes(res) : 0)

/** Makes the projection view uniform of `res` and its blue noise, where it holds none: before the
 *  frame's lists, so that they never take the room they need. */
export function vsmProjectionReserve(device: GPUDevice, res: VsmResources) {
  const state = projectionState(res)
  state.uniform ??= device.createBuffer({
    label: 'vsm.projection.view',
    size: VSM_PROJECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  if (!state.blueNoise) {
    state.blueNoise = createVsmBlueNoiseTexture(device)
    state.blueNoiseView = state.blueNoise.createView()
  }
  return state
}

/** The view uniform and the blue noise the projection of `res` reads: what a blended surface's
 *  trace reads too (`vsmTraceFactor`), the same view and noise. None before the set's
 *  first reservation. */
export function vsmProjectionShared(res: VsmResources) {
  const state = res.projection
  return state?.uniform && state.blueNoiseView
    ? { view: state.uniform, noise: state.blueNoiseView }
    : undefined
}

/** The one-texel memory and transmission target a pass of `state` binds without translucent
 *  casters, made at its first ask. */
export function vsmProjectionStandIns(device: GPUDevice, state: VsmProjectionState) {
  if (state.standIns) return state.standIns
  state.noTransmission = standInTexture(
    device,
    'vsm.projection.noTransmission',
    VSM_TRANSMISSION_FORMAT,
  )
  state.noThrough = device.createTexture({
    label: 'vsm.projection.noThrough',
    size: [1, 1, 1],
    format: VSM_PROJECTION_THROUGH_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING,
  })
  return (state.standIns = {
    transmission: arrayView(state.noTransmission),
    through: arrayView(state.noThrough),
  })
}

/** Frees what the projection of `res` holds, with the set (`destroyEngineVsm`). */
export function releaseVsmProjection(res: VsmResources) {
  const state = res.projection
  if (!state) return
  res.projection = undefined
  state.uniform?.destroy()
  state.blueNoise?.destroy()
  state.noTransmission?.destroy()
  state.noThrough?.destroy()
}

function projectionState(res: VsmResources) {
  if (res.projection) return res.projection
  const staging = new ArrayBuffer(VSM_PROJECTION_VIEW_BYTES)
  return (res.projection = {
    staging,
    tables: vsmFrameSetHeld(),
    pass: heldGroup(),
    receiver: heldGroup(),
    words: {
      f: new Float32Array(staging),
      u: new Uint32Array(staging),
      i: new Int32Array(staging),
    },
  })
}
