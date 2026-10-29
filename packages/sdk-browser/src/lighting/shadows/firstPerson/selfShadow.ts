import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { firstPersonBoundsOf } from '../../reflections/firstPersonBounds.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'
import {
  releaseSelfShadowGrid,
  runSelfShadow,
  selfShadowRecords as records,
} from './selfShadowKit.ts'
import { releaseLocalSelfShadow } from './selfShadowLocal.ts'
import { SELF_SHADOW_MAX_LIGHTS } from './selfShadowWgsl.ts'

/** The sphere that holds the first-person objects (centre, radius), filled by `firstPersonBoundsOf`. */
const firstPersonBounds = new Float64Array(4)

/** Whether the first-person objects take a screen shadow this image: the setting on, a first-person object in the scene and the screen reflection's trace
 *  layers made. */
const selfShadowOn = (rt: WebgpuPagesRuntime, shadows: ShadowValues) =>
  shadows.shadowFirstPersonSelfShadow &&
  !!rt.gpu.reflection &&
  firstPersonBoundsOf(rt, firstPersonBounds)[3]! > 0

/** Whether the pixels of the first-person objects take a screen shadow from the suns this image (`shadowFirstPersonSelfShadowLightTypes` 0 or 2). */
export const firstPersonSelfShadowOn = (rt: WebgpuPagesRuntime, shadows: ShadowValues) =>
  selfShadowOn(rt, shadows) && shadows.shadowFirstPersonSelfShadowLightTypes !== 1

/** Whether they take one from the local lights this image (`shadowFirstPersonSelfShadowLightTypes` 1 or 2). */
export const firstPersonLocalSelfShadowOn = (rt: WebgpuPagesRuntime, shadows: ShadowValues) =>
  selfShadowOn(rt, shadows) && shadows.shadowFirstPersonSelfShadowLightTypes !== 0

/** The textures the self shadow holds, let go (retired) while no light gives a self shadow: nothing is held for a feature unused. */
export function releaseFirstPersonSelfShadow(rt: WebgpuPagesRuntime) {
  const { device } = rt.gpu
  if (!device) return
  releaseSelfShadowGrid(device)
  releaseLocalSelfShadow(device)
}

/**
 * THE FIRST-PERSON SELF SHADOW OF THE SUNS (`selfShadowWgsl.ts`), after the projection has written the suns' mask: the kernels (`runSelfShadow`) run over the
 * suns, each taking its shadow into its layer of `sunMask` by the minimum, a run for each `SELF_SHADOW_MAX_LIGHTS` of them. `views` are the surfaces' views (the normals at 1, the flags at 3).
 */
export function encodeFirstPersonSelfShadow(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  lights: readonly VsmProjectionLight[],
  suns: number,
  sunMask: GPUTextureView,
  views: readonly GPUTextureView[],
) {
  for (let first = 0; first < suns; first += SELF_SHADOW_MAX_LIGHTS) {
    const count = Math.min(suns - first, SELF_SHADOW_MAX_LIGHTS)
    for (let k = 0; k < count; k++) {
      // The direction toward the sun, and 0: a sun's record.
      const d = lights[first + k]!.direction
      records.set([-d[0]!, -d[1]!, -d[2]!, 0], 4 * k)
    }
    runSelfShadow(
      rt,
      encoder,
      settings,
      { lights: records, count, output: sunMask, layerBase: first },
      views,
    )
  }
}
