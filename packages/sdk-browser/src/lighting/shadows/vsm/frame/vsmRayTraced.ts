// The ray traced shadow of the projection (`../../rayTraced/`): which lights cast theirs by rays this image, and how it is taken into the masks the projection reads.
import type { ShadowValues } from '../../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { sceneRaysOf, type SceneRays } from '../../../surfaceCache/lighting/surfaceLighting.ts'
import {
  encodeLocalRayTraced,
  encodeSunRayTraced,
  trimRayTraced,
  type LocalRayTraced,
  type SunRayTraced,
} from '../../rayTraced/rayTracedLocal.ts'
import { runRayTracedShadow } from '../../rayTraced/rayTracedKit.ts'
import { shadowDenoiseReady } from '../../denoise/shadowDenoiseFrame.ts'
import { rayTracedDenoised, rayTracedSamples } from '../../rayTraced/rayTracedLights.ts'
import type { PerLightInputs } from '../projection/perLightPass.ts'
import type { VsmProjectionLight } from '../projection/projectionPass.ts'
import { projectedLightRect } from '../projection/perLightScissor.ts'
import { sunCount } from '../projection/projectionView.ts'
import type { VsmFrame } from './vsmProject.ts'

/** The lights that cast their shadow by rays this image: the scene trace the lighting made for it, and the rays a pixel casts to each light of the frame (0 for none). */
export interface RayTracedPlan {
  rays: SceneRays
  samples: number[]
  /** The lights whose ray traced shadow is denoised (`rayTracedDenoised`). */
  denoised: boolean[]
  /** Whether the denoiser runs this image (`shadowDenoiseReady`, decided once for the image): a denoised light keeps its plain trace where it does not. */
  canDenoise: boolean
  suns: boolean
  locals: boolean
}

/** The plan of the frame's `lights`; none while no light casts by rays or the lighting made no scene trace for this image (the lights keep their shadow maps). */
export function rayTracedPlan(
  frame: VsmFrame,
  shadows: ShadowValues,
  lights: readonly VsmProjectionLight[],
): RayTracedPlan | undefined {
  const { rt, plan } = frame
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!rays) return undefined
  const suns = sunCount(lights)
  const stored = lights.map((_, k) => rt.lights.store.light(plan.projected[k]!.id))
  const samples = stored.map((light) => (light ? rayTracedSamples(shadows, light) : 0))
  const denoised = stored.map((light) => !!light && rayTracedDenoised(shadows, light))
  const canDenoise = denoised.includes(true) && shadowDenoiseReady(rt)
  const traced = { rays, samples, denoised, canDenoise, suns: false, locals: false }
  samples.forEach((count, k) => {
    if (count > 0) traced[k < suns ? 'suns' : 'locals'] = true
  })
  return traced.suns || traced.locals ? traced : undefined
}

/** The rectangle a light reaches, written by `projectedLightRect`. */
const lightRect = new Int32Array(4)

/** The rank, in the light buffer, of light `k` of the frame's lights. */
const rankOf = ({ rt, plan }: VsmFrame, k: number) => rt.lights.store.slotOf(plan.projected[k]!.id)

/** The suns' ray traced shadow, after the projection wrote the suns' mask: each sun that casts by rays takes its into its layer of `sunMask` by the minimum (a denoised sun goes through the denoiser where it can run this image, through the
 *  plain minimum where it cannot, so that its shadow is never lost). */
export function encodeRayTracedSuns(
  frame: VsmFrame,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  traced: RayTracedPlan,
  suns: number,
  sunMask: GPUTextureView,
  views: readonly GPUTextureView[],
) {
  const denoised: SunRayTraced[] = []
  for (let k = 0; k < suns; k++) {
    const rank = rankOf(frame, k)
    if (traced.samples[k]! <= 0 || rank < 0) continue
    if (traced.denoised[k] && traced.canDenoise) {
      denoised.push({
        rank,
        samples: traced.samples[k]!,
        key: frame.plan.projected[k]!.id,
        mask: sunMask,
        slot: k,
      })
      continue
    }
    runRayTracedShadow(
      frame.rt,
      encoder,
      settings,
      traced.rays,
      { rank, samples: traced.samples[k]!, output: sunMask, layerBase: k },
      views,
    )
  }
  encodeSunRayTraced(frame.rt, encoder, frame.cam, settings, traced.rays, denoised, views)
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
  const [width, height] = frame.rt.gpu.targetSize
  for (let k = sunCount(lights); k < Math.min(lights.length, layers.length); k++) {
    const rank = rankOf(frame, k)
    const light = lights[k]!
    if (traced.samples[k]! <= 0 || rank < 0 || light.type === 'directional') continue
    // The pixels the light reaches, as the per-light path takes them: a light past the screen casts nothing.
    if (
      !projectedLightRect(
        lightRect,
        0,
        light.position,
        light.radius,
        frame.cam.view,
        frame.projection,
        frame.cam.perspective === 1,
        width,
        height,
      )
    )
      continue
    jobs.push({
      rank,
      samples: traced.samples[k]!,
      target: layers[k]!,
      format: 'r8unorm',
      denoise: traced.denoised[k] ? frame.plan.projected[k]!.id : undefined,
      rect: [lightRect[0]!, lightRect[1]!, lightRect[2]!, lightRect[3]!],
    })
  }
  encodeLocalRayTraced(
    frame.rt,
    encoder,
    frame.cam,
    frame.vsm.state.maps.shadows,
    traced.rays,
    traced.canDenoise,
    jobs,
    views,
  )
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
      denoise: traced.denoised[k] ? frame.plan.projected[k]!.id : undefined,
    }
    encodeLocalRayTraced(
      frame.rt,
      encoder,
      frame.cam,
      frame.vsm.state.maps.shadows,
      traced.rays,
      traced.canDenoise,
      [job],
      views,
      rect,
    )
  }
}

/** What the view lets go of while no light casts by rays, run once an image of the view: after the keeping delay (`trimRayTraced`), so that a gap of an image keeps the histories. */
export const idleRayTraced = (rt: WebgpuPagesRuntime) => trimRayTraced(rt.gpu, rt.run.frame)
