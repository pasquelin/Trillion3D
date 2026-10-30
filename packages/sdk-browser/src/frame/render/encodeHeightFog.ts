import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { litImageShown } from '../prepare/contractLight.ts'
import { shownHeightFog } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogHoldout } from '../prepare/alphaHoldout.ts'

/** Whether the image shows a fog — the scene's, height or distance —, an atmosphere (`air`, whose haze
 *  lies over the surfaces), or a local fog volume; the unlit view and the views that paint raw values
 *  show none. */
export const fogLays = (rt: WebgpuPagesRuntime, air: boolean) => !!fogTarget(rt, air)

/** What the fog is laid with and onto where the image shows one (`fogLays`): the deferred lighting and the lit image. */
function fogTarget(rt: WebgpuPagesRuntime, air: boolean) {
  const { gpu, lights } = rt
  const { deferred, hdrView } = gpu
  if (!deferred?.usesContract || !hdrView || !litImageShown(rt)) return undefined
  const shown = air || !!lights.store.environment?.fog || (gpu.localFog?.plan.count ?? 0) > 0
  return shown ? { deferred, hdrView } : undefined
}

/**
 * THE FOG OVER THE LIT IMAGE, laid by its own pass once the lights and the sky are in it
 * (`../../lighting/fog/fogPass.ts`): over the surfaces, and over the pixels no surface drew where no
 * atmosphere draws a sky, where the image shows one (`fogLays`).
 */
export function encodeHeightFog(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder, air: boolean) {
  const target = fogTarget(rt, air)
  if (!target) return
  // A height fog that holds its light out punches a hole in the alpha (`SceneHeightFog.holdout`).
  const holdout = fogHoldout(rt, shownHeightFog(rt.lights.store.environment?.fog))
  target.deferred.fog(encoder, target.hdrView, holdout)
}
