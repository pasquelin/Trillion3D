// The forward sun's shadow on the single-layer water (`projection/waterSunProjection.ts`), asked by the water pass.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { sunCount } from '../projection/projectionView.ts'
import {
  encodeWaterSunProjection,
  waterSunProjectionReady,
  type VsmWaterSunSource,
} from '../projection/waterSunProjection.ts'

/** The layer of the suns' mask that holds the forward directional light (the one the water's separated sun is,
 *  `SceneLightStore.forwardDirectionalSlot`), or −1 where this frame does not project it: no projection, no
 *  forward light, a light that casts no shadow, or the program over the water still compiling. */
export function waterSunLayer(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const vsm = rt.lights.vsm,
    plan = vsm?.plan,
    scratch = vsm?.frameScratch
  if (!vsm || !plan || !scratch?.projecting) return -1
  const { store } = rt.lights
  const slot = store.forwardDirectionalSlot
  const held = vsm.res.projection
  // The projection needs its uniform and the blue noise, else nothing is encoded and the sun would go unshadowed.
  if (
    slot < 0 ||
    !held?.uniform ||
    !held.blueNoiseView ||
    !waterSunProjectionReady(device, vsm.res)
  )
    return -1
  const suns = sunCount(scratch.context.lights)
  for (let k = 0; k < suns; k++) if (store.slotOf(plan.projected[k].id) === slot) return k
  return -1
}

/** Projects this frame's suns onto the water (`source`) and returns the mask, a layer a sun (`waterSunLayer`),
 *  or none where nothing was encoded. */
export function encodeWaterSun(
  rt: WebgpuPagesRuntime,
  steps: ComputeRun,
  source: VsmWaterSunSource,
) {
  const vsm = rt.lights.vsm,
    scratch = vsm?.frameScratch
  return vsm && scratch?.projecting
    ? encodeWaterSunProjection(steps, vsm.res, scratch.context, source)
    : undefined
}
