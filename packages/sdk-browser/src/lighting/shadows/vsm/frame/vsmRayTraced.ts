// The ray traced shadow of the projection (`../../rayTraced/`): which lights cast theirs by rays this image, and how it is taken into the masks the projection reads.
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { sceneRaysOf, type SceneRays } from '../../../surfaceCache/lighting/surfaceLighting.ts'
import { encodeLocalRayTraced, type LocalRayTraced } from '../../rayTraced/rayTracedLocal.ts'
import { runRayTracedShadow } from '../../rayTraced/rayTracedKit.ts'
import { rayTracedSamples } from '../../rayTraced/rayTracedLights.ts'
import type { PerLightInputs } from '../projection/perLightPass.ts'
import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import { sunCount } from '../projection/projectionView.ts'
import type { VsmFrame } from './vsmProject.ts'

/** The lights that cast their shadow by rays this image: the scene trace the lighting made for it, and the rays a pixel casts to each light of the frame (0 for none). */
export interface RayTracedPlan {
  rays: SceneRays
  samples: number[]
  suns: boolean
  locals: boolean
}

/** The plan of the frame's `lights`; none while no light casts by rays or the lighting made no scene trace for this image (the lights keep their shadow maps). */
export function rayTracedPlan(
  { rt, plan }: VsmFrame,
  shadows: ShadowValues,
  lights: readonly VsmProjectionLight[],
): RayTracedPlan | undefined {
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!rays) return undefined
  const suns = sunCount(lights)
  const samples = lights.map((_, k) => {
    const light = rt.lights.store.light(plan.projected[k]!.id)
    return light ? rayTracedSamples(shadows, light) : 0
  })
  const traced = { rays, samples, suns: false, locals: false }
  samples.forEach((count, k) => {
    if (count > 0) traced[k < suns ? 'suns' : 'locals'] = true
  })
  return traced.suns || traced.locals ? traced : undefined
}

/** The rank, in the light buffer, of light `k` of the frame's lights. */
const rankOf = ({ rt, plan }: VsmFrame, k: number) => rt.lights.store.slotOf(plan.projected[k]!.id)

/** The suns' ray traced shadow, after the projection wrote the suns' mask: each sun that casts by rays takes its into its layer of `sunMask` by the minimum. */
export function encodeRayTracedSuns(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  traced: RayTracedPlan,
  suns: number,
  sunMask: GPUTextureView,
  views: readonly GPUTextureView[],
) {
  for (let k = 0; k < suns; k++) {
    const rank = rankOf(frame, k)
    if (traced.samples[k]! <= 0 || rank < 0) continue
    runRayTracedShadow(
      frame.rt,
      encoder,
      settings,
      traced.rays,
      { rank, samples: traced.samples[k]!, output: sunMask, layerBase: k },
      views,
    )
  }
}

/** The local lights' ray traced shadow on the one-pass path, taken into the capsule layers the projection reads, a view each light of the frame. */
export function encodeOnePassLocalRayTraced(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  traced: RayTracedPlan,
  lights: readonly VsmProjectionLight[],
  layers: readonly GPUTextureView[],
  views: readonly GPUTextureView[],
) {
  const jobs: LocalRayTraced[] = []
  for (let k = sunCount(lights); k < Math.min(lights.length, layers.length); k++) {
    const rank = rankOf(frame, k)
    if (traced.samples[k]! > 0 && rank >= 0)
      jobs.push({ rank, samples: traced.samples[k]!, target: layers[k]!, format: 'r8unorm' })
  }
  encodeLocalRayTraced(frame.rt, encoder, frame.vsm.state.maps.shadows, traced.rays, jobs, views)
}

/** The local lights' ray traced shadow on the per-light path, as the callback a light's projection takes (`PerLightInputs.afterMask`): taken into the light's layer of
 *  the mask over the pixels the light reaches. */
export function perLightRayTraced(
  frame: VsmFrame,
  lights: readonly VsmProjectionLight[],
  traced: RayTracedPlan,
  views: readonly GPUTextureView[],
): PerLightInputs['afterMask'] {
  return (encoder, light, layer, rect) => {
    const k = lights.indexOf(light)
    const rank = k < 0 ? -1 : rankOf(frame, k)
    if (rank < 0 || traced.samples[k]! <= 0) return
    const job: LocalRayTraced = {
      rank,
      samples: traced.samples[k]!,
      target: layer,
      format: 'rgba8unorm',
    }
    encodeLocalRayTraced(
      frame.rt,
      encoder,
      frame.vsm.state.maps.shadows,
      traced.rays,
      [job],
      views,
      rect,
    )
  }
}

/** The ray traced shadow's texture let go (retired) while no light casts by rays. */
export { releaseRayTracedLocal as releaseRayTraced } from '../../rayTraced/rayTracedLocal.ts'
