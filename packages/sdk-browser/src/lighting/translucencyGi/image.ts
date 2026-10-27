import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { invertMatrix4 } from '../../../../math/src/matrix/matrix4Inverse.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { skyLightReadOf } from '../../frame/render/skyLightState.ts'
import { preExposureOf } from '../../post/exposure/pre.ts'
import { reflectionGroup, reflectionLightView } from '../reflections/group.ts'
import type { GiImage } from './gpu.ts'
import type { TranslucencyGiGrid } from './layout.ts'

/** The reflection group of the image (the depth pyramid, the view, the sky light), none while the frame lacks any of it. */
export function reflectionGroupOf(rt: WebgpuPagesRuntime) {
  const { reflection } = rt.gpu
  const depth = rt.vis.gpuHiz?.depth()
  const lightView = reflectionLightView(rt)
  if (!reflection || !depth || !lightView) return undefined
  return reflectionGroup(reflection, depth, lightView, skyLightReadOf(rt))
}

/** The image of the frame the volume is built from, rewritten in place: the camera's eye and its view-projection, set at the eye
 *  (`viewProjectionRelative`), and the inverse of that are the ones without the anti-aliasing jitter, so that the cells' places and the
 *  history's reprojection do not shake with it, and a cell's place is found, and carried to the image before's, relative to the eye, far
 *  from the origin. */
const IMAGE: GiImage = {
  width: 0,
  height: 0,
  near: 0,
  preExposure: 1,
  frame: 0,
  history: false,
  eye: new Float64Array(3),
  viewProjection: new Float64Array(16),
  inverse: new Float64Array(16),
}
export function imageOf(rt: WebgpuPagesRuntime, cam: EngineCamera, history: boolean) {
  IMAGE.width = rt.gpu.targetSize[0]
  IMAGE.height = rt.gpu.targetSize[1]
  IMAGE.near = cam.near
  IMAGE.preExposure = preExposureOf(rt).now
  IMAGE.frame = rt.run.frame
  IMAGE.history = history
  IMAGE.eye = cam.eye
  IMAGE.viewProjection = cam.viewProjectionRelative
  invertMatrix4(IMAGE.inverse as Float64Array, cam.viewProjectionRelative)
  return IMAGE
}

/** The numbers an image's history and marks depend on (`LAW_WORDS`), written into `out`. */
export function lawOf(
  out: Float64Array,
  grid: TranslucencyGiGrid,
  tracing: number,
  near: number,
  v: TranslucencyGiValues,
  bias: number,
) {
  out[0] = grid.x
  out[1] = grid.y
  out[2] = grid.z
  out[3] = grid.shift
  out[4] = grid.logZScale
  out[5] = grid.logZOffset
  out[6] = grid.zScale
  out[7] = near
  out[8] = tracing
  out[9] = bias
  out[10] = v.translucencyGiTemporalJitter ? 1 : 0
}

/** Whether the first `count` words of two laws are the same. */
export function sameLaw(a: Float64Array, b: Float64Array, count: number) {
  for (let k = 0; k < count; k++) if (a[k] !== b[k]) return false
  return true
}
