import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { firstPersonBoundsOf } from '../../reflections/firstPersonBounds.ts'
import { localMaskMerge, type LocalMaskFormat } from '../localMaskMerge.ts'
import type { VsmProjectionLight } from '../vsm/projection/projectionPass.ts'
import { lightAffectsSphere } from './affects.ts'
import { runSelfShadow, selfShadowRecords as records } from './selfShadowKit.ts'
import type { SelfShadowRect } from './selfShadowWindow.ts'
import {
  SELF_SHADOW_MAX_LIGHTS,
  SELF_SHADOW_MERGE_BINDINGS as M,
  SELF_SHADOW_MERGE_ENTRY,
  selfShadowMergeProgram,
} from './selfShadowWgsl.ts'

/** One local light to give the first-person objects a self shadow: the light, its rank in the light buffer, and the mask (a view of the format) it is taken into. */
export interface LocalSelfShadow {
  light: VsmProjectionLight
  rank: number
  target: GPUTextureView
  format: LocalMaskFormat
}

const merger = localMaskMerge({
  label: 'Trillion3D first person self shadow merge',
  passLabel: 'vsm.firstPersonSelfShadow.merge',
  entry: SELF_SHADOW_MERGE_ENTRY,
  module: (device) =>
    device.createShaderModule({
      label: 'Trillion3D first person self shadow merge',
      code: selfShadowMergeProgram(),
    }),
  flagsBinding: M.flags,
})

/** The local lights' texture let go (retired). */
export const releaseLocalSelfShadow = merger.release

/** Image `frame` is over: the local lights' layers' keeping window folds it where no light asked. */
export const keepLocalSelfShadow = merger.keep

const bounds = new Float64Array(4)

/** Whether any of the local lights `lights` from index `first` reaches the first-person objects' bounds: the lights that take a self shadow (`lightAffectsSphere`). */
export function localLightsReachFirstPerson(
  rt: WebgpuPagesRuntime,
  lights: readonly VsmProjectionLight[],
  first: number,
) {
  if (firstPersonBoundsOf(rt, bounds)[3]! <= 0) return false
  for (let k = first; k < lights.length; k++)
    if (lightAffectsSphere(lights[k]!, bounds, bounds[3]!)) return true
  return false
}

/**
 * THE FIRST-PERSON SELF SHADOW OF THE LOCAL LIGHTS: for each of `jobs` whose light reaches the first-person objects' bounds (`lightAffectsSphere`; a
 * sun's is traced beside the suns', `encodeFirstPersonSelfShadow`), the kernels (`runSelfShadow`) trace the first-person pixels toward the light, over
 * `scissor` (first column and row, one past the last; the drawn image by default), and its layer is taken into the light's mask by the minimum over the
 * same rectangle, as the square root the masks keep. The lights go in runs of `SELF_SHADOW_MAX_LIGHTS`, none left out. `views` are the surfaces' views (the
 * normals at 1, the flags at 3). Nothing for a light that does not reach them.
 */
export function encodeLocalSelfShadows(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  jobs: readonly LocalSelfShadow[],
  views: readonly GPUTextureView[],
  scissor?: SelfShadowRect,
) {
  const { device } = rt.gpu
  if (!device || firstPersonBoundsOf(rt, bounds)[3]! <= 0) return
  const reached = jobs.filter((job) => lightAffectsSphere(job.light, bounds, bounds[3]!))
  const [x0, y0, x1, y1] = scissor ?? [0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1]]
  for (let first = 0; first < reached.length; first += SELF_SHADOW_MAX_LIGHTS) {
    const run = reached.slice(first, first + SELF_SHADOW_MAX_LIGHTS)
    run.forEach((job, k) => records.set([job.rank, 0, 0, 1], 4 * k))
    const out = merger.layersFor(
      rt.gpu,
      device,
      rt.gpu.allocatedSize,
      run.length,
      false,
      rt.run.frame,
    )
    const traced = runSelfShadow(
      rt,
      encoder,
      settings,
      { lights: records, count: run.length, output: out.storage, rect: [x0, y0, x1, y1] },
      views,
    )
    if (!traced) return
    run.forEach((job, k) =>
      merger.merge(
        device,
        encoder,
        job.format,
        job.target,
        out.layers[k]!,
        [x0, y0, x1, y1],
        views[3],
      ),
    )
  }
}
