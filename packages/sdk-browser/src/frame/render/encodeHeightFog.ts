import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import { shownHeightFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogHoldout } from '../prepare/alphaHoldout.ts'

/**
 * THE FOG OVER THE LIT IMAGE, laid by its own pass once the lights and the sky are in it
 * (`../../lighting/fog/fogPass.ts`): over the surfaces, and over the pixels no surface drew where no
 * atmosphere draws a sky. Drawn where the image shows a fog — the scene's, height or distance —, an
 * atmosphere (`air`, whose haze lies over the surfaces), or a local fog volume; the unlit view and the
 * views that paint raw values show none.
 */
export function encodeHeightFog(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, air: boolean) {
  const { gpu, lights } = rt
  const { deferred, hdrView } = gpu
  if (!deferred?.usesContract || !hdrView || !litImageShown(rt)) return
  const lays = air || !!lights.store.environment?.fog || (gpu.localFog?.plan.count ?? 0) > 0
  // A height fog that holds its light out punches a hole in the alpha (`SceneHeightFog.holdout`).
  const holdout = fogHoldout(rt, shownHeightFog(lights.store.environment?.fog))
  if (lays) deferred.fog(encoder, hdrView, holdout)
}
