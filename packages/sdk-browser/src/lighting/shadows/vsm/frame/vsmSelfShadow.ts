// The first-person self shadow of the projection (`../../firstPerson/selfShadow.ts`): which lights give it this image, and how the local lights' is taken
// into the masks the projection reads.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import {
  firstPersonLocalSelfShadowOn,
  firstPersonSelfShadowOn,
  releaseFirstPersonSelfShadow,
} from '../../firstPerson/selfShadow.ts'
import {
  encodeLocalSelfShadows,
  localLightsReachFirstPerson,
  type LocalSelfShadow,
} from '../../firstPerson/selfShadowLocal.ts'
import type { PerLightInputs } from '../projection/perLightPass.ts'
import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import { sunCount } from '../projection/projectionView.ts'
import type { VsmFrame } from './vsmProject.ts'

/** Which kinds of light give the first-person objects a self shadow this image; the textures of the feature let go when none does. */
export function selfShadowLights(
  rt: WebgpuPagesRuntime,
  shadows: ShadowValues,
  lights: readonly VsmProjectionLight[],
) {
  const suns = sunCount(lights)
  const given = {
    suns: suns > 0 && firstPersonSelfShadowOn(rt, shadows),
    // Only a local light that reaches the first-person objects gets a self shadow: the masks stand held, the capsule layers unmade, where none does.
    locals:
      lights.length > suns &&
      firstPersonLocalSelfShadowOn(rt, shadows) &&
      localLightsReachFirstPerson(rt, lights, suns),
  }
  if (!given.suns && !given.locals) releaseFirstPersonSelfShadow(rt)
  return given
}

/** The rank, in the light buffer, of light `k` of the frame's lights. */
const rankOf = ({ rt, plan }: VsmFrame, k: number) => rt.lights.store.slotOf(plan.projected[k]!.id)

/** The local lights' self shadow on the one-pass path, taken into the capsule layers the projection reads, a view each light of the frame (`capsuleLocalLayers`). */
export function encodeOnePassLocalSelfShadow(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  lights: readonly VsmProjectionLight[],
  layers: readonly GPUTextureView[],
  views: readonly GPUTextureView[],
) {
  const jobs: LocalSelfShadow[] = []
  for (let k = sunCount(lights); k < Math.min(lights.length, layers.length); k++) {
    const rank = rankOf(frame, k)
    if (rank >= 0) jobs.push({ light: lights[k]!, rank, target: layers[k]!, format: 'r8unorm' })
  }
  encodeLocalSelfShadows(frame.rt, encoder, frame.vsm.state.maps.shadows, jobs, views)
}

/** The local lights' self shadow on the per-light path, as the callback a light's projection takes (`PerLightInputs.afterMask`): taken into the light's layer of
 *  the mask over the pixels the light reaches. */
export function perLightSelfShadow(
  frame: VsmFrame,
  lights: readonly VsmProjectionLight[],
  views: readonly GPUTextureView[],
): PerLightInputs['afterMask'] {
  return (encoder, light, layer, rect) => {
    const k = lights.indexOf(light)
    if (k < 0) return
    const rank = rankOf(frame, k)
    if (rank < 0) return
    const job: LocalSelfShadow = { light, rank, target: layer, format: 'rgba8unorm' }
    encodeLocalSelfShadows(frame.rt, encoder, frame.vsm.state.maps.shadows, [job], views, rect)
  }
}

/** The callbacks `first` and `second` as one, either absent. */
export function afterBoth(
  first: PerLightInputs['afterMask'],
  second: PerLightInputs['afterMask'],
): PerLightInputs['afterMask'] {
  if (!first || !second) return first ?? second
  return (encoder, light, layer, rect) => {
    first(encoder, light, layer, rect)
    second(encoder, light, layer, rect)
  }
}
