/**
 * WHAT A SET'S PROJECTION HOLDS (`projectionPass.ts`): its view uniform, its blue noise, its groups
 * and the bytes they take, made before the frame's lists and freed with the set.
 */
import { createWebgpuBindIdentity, type WebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { createVsmBlueNoiseTexture, VSM_BLUE_NOISE_BYTES } from './blueNoise.ts'
import { VSM_PROJECTION_VIEW_BYTES } from './projectionView.ts'
import { vsmFrameSetHeld, type VsmPerFrameSet, type VsmResources } from './resources.ts'
import type { ViewWords } from './projectionViewWrite.ts'

/** What a set's projection holds (`vsmProjectionReserve`), freed with the set
 *  (`releaseVsmProjection`): never shared by two sessions on one device. The engine projects once a
 *  frame into its one mask: one view uniform and one pass group. */
export interface VsmProjectionState {
  uniform?: GPUBuffer
  /** Group 0 over the tables of a frame set and the layout (`vsmPerFrameSet`), the two sets in
   *  turn. */
  tables: VsmPerFrameSet<GPUBindGroup>
  /** The pass group over the layout and the frame's views (`passGroupFor`), made again when one
   *  of them moved. */
  pass: WebgpuBindIdentity
  passGroup?: GPUBindGroup
  /** The receiver group over its layout and view (`receiverGroupFor`): one kept, made again when
   *  one of them moved. */
  receiver: WebgpuBindIdentity
  receiverGroup?: GPUBindGroup
  /** The view uniform's image, uploaded each frame, and its words. */
  staging: ArrayBuffer
  words: ViewWords
  /** The set's blue noise (`createVsmBlueNoiseTexture`) and its view. */
  blueNoise?: GPUTexture
  blueNoiseView?: GPUTextureView
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

/** The view uniform and the blue noise the projection of `res` reads: what a blended surface's and
 *  the water's trace reads too (`vsmTraceFactor`), the same view and noise. None before the set's
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
  state.blueNoise?.destroy()
}

export function projectionState(res: VsmResources) {
  if (res.projection) return res.projection
  const staging = new ArrayBuffer(VSM_PROJECTION_VIEW_BYTES)
  return (res.projection = {
    staging,
    tables: vsmFrameSetHeld(),
    pass: createWebgpuBindIdentity(),
    receiver: createWebgpuBindIdentity(),
    words: {
      f: new Float32Array(staging),
      u: new Uint32Array(staging),
      i: new Int32Array(staging),
    },
  })
}
