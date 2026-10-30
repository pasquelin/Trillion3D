import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { EngineCamera } from '../../../camera/engineCamera.ts'
import {
  encodeShadowDenoise,
  releaseShadowDenoise,
  trimShadowDenoise,
  type ShadowDenoiseJob,
} from '../denoise/shadowDenoiseFrame.ts'
import { idleTooLong } from '../../../gpu/core/idleKeep.ts'
import { localMaskMerge, type LocalMaskFormat, type LocalMaskLayers } from '../localMaskMerge.ts'
import type { SelfShadowRect } from '../firstPerson/selfShadowWindow.ts'
import { lastTracedAt, releaseRayTracedGroups, runRayTracedShadow } from './rayTracedKit.ts'
import { RAY_TRACED_MERGE_ENTRY, rayTracedMergeProgram } from './rayTracedWgsl.ts'

/** One light to give a ray traced shadow: its rank in the light buffer, the rays a pixel casts to it, and, for a local light, the mask (a view of the format) it is taken into; `denoise` names its key where its shadow is denoised. */
export interface LocalRayTraced {
  rank: number
  samples: number
  target: GPUTextureView
  format: LocalMaskFormat
  denoise?: string | number
  /** The pixels the light reaches (the first column and row, one past the last); the call's scissor where absent. */
  rect?: SelfShadowRect
}

const merger = localMaskMerge({
  label: 'Trillion3D ray traced shadow merge',
  passLabel: 'vsm.rayTracedShadow.merge',
  entry: RAY_TRACED_MERGE_ENTRY,
  module: (device) =>
    device.createShaderModule({
      label: 'Trillion3D ray traced shadow merge',
      code: rayTracedMergeProgram(),
    }),
})

/** A view's textures of the traced lights let go (retired). */
export function releaseRayTracedLocal(gpu: { viewKey?: object }) {
  releaseRayTracedGroups(gpu)
  merger.release(gpu)
}

/** What a view lets go of while it traces nothing, on the one stamp of its last traced image: the denoiser's idle histories and, once it has traced nothing for `IDLE_KEEP_IMAGES` images, the lights' textures and the denoiser's state. A one-image gap lets go of nothing. */
export function trimRayTraced(gpu: { viewKey?: object }, frame: number) {
  const last = lastTracedAt(gpu)
  // A view that never traced (or lost its stamp with its rays) has no use for a denoiser state.
  if (last === undefined) releaseShadowDenoise(gpu)
  else if (idleTooLong(frame, last)) {
    releaseRayTracedLocal(gpu)
    releaseShadowDenoise(gpu)
  } else {
    trimShadowDenoise(gpu, frame)
    merger.keep(gpu, frame)
  }
}

/** A sun to give a denoised ray traced shadow: its rank, the rays a pixel casts to it, its key and the layer of the suns' mask it is taken into. */
export interface SunRayTraced {
  rank: number
  samples: number
  key: string | number
  mask: GPUTextureView
  slot: number
}

/**
 * One light's trace into layer `k` of `out`: over `rect` (the drawn image by default) into the layer's visibility, with a `denoise` key with the blockers'
 * distances beside it, the job queued in `queue` for the denoiser over the same `rect` (`denoise.sun`: the layer of the suns' mask its result is taken into). Whether the kernel ran.
 */
function traceInto(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  settings: ShadowValues,
  rays: SceneRays,
  views: readonly GPUTextureView[],
  out: LocalMaskLayers,
  k: number,
  light: { rank: number; samples: number },
  rect: SelfShadowRect | undefined,
  queue: ShadowDenoiseJob[],
  denoise: { key: string | number | undefined; sun?: ShadowDenoiseJob['sun'] },
) {
  const ran = runRayTracedShadow(
    rt,
    encoder,
    settings,
    rays,
    {
      rank: light.rank,
      samples: light.samples,
      output: out.storage,
      hits: denoise.key !== undefined ? out.hits?.storage : undefined,
      layerBase: k,
      rect,
    },
    views,
  )
  if (ran && denoise.key !== undefined)
    queue.push({
      key: denoise.key,
      rank: light.rank,
      rect,
      visibility: out.layers[k]!,
      hits: out.hits!.layers[k]!,
      sun: denoise.sun,
    })
  return ran
}

/**
 * THE RAY TRACED SHADOW OF LOCAL LIGHTS: for each of `jobs` the kernel (`runRayTracedShadow`) casts its rays over the light's own `rect`, or `scissor` (first column and row, one past the
 * last; the drawn image by default) into a layer of the lights' texture; a light that is denoised (`denoise`) is traced with its blocker distances and denoised over the same scissor, its screen rect
 * (`encodeShadowDenoise`). The layer is taken into the light's mask by the minimum over the scissor, as the square root the masks keep. Every other shadow of the light stands.
 */
export function encodeLocalRayTraced(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  settings: ShadowValues,
  rays: SceneRays,
  canDenoise: boolean,
  jobs: readonly LocalRayTraced[],
  views: readonly GPUTextureView[],
  scissor?: SelfShadowRect,
) {
  const { device } = rt.gpu
  if (!device) return
  if (!jobs.length) return
  const [x0, y0, x1, y1] = scissor ?? [0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1]]
  const out = merger.layersFor(
    rt.gpu,
    device,
    rt.gpu.allocatedSize,
    jobs.length,
    canDenoise && jobs.some((j) => j.denoise !== undefined),
    rt.run.frame,
  )
  const whole = [x0, y0, x1, y1] as const
  const denoised: ShadowDenoiseJob[] = []
  const traced = jobs.map((job, k) =>
    traceInto(rt, encoder, settings, rays, views, out, k, job, job.rect ?? whole, denoised, {
      key: canDenoise ? job.denoise : undefined,
    }),
  )
  encodeShadowDenoise(rt, encoder, cam, settings, denoised)
  jobs.forEach((job, k) => {
    if (traced[k])
      merger.merge(device, encoder, job.format, job.target, out.layers[k]!, job.rect ?? whole)
  })
}

/** The suns' ray traced shadow that is denoised: traced whole into scratch layers, denoised, and taken into their layers of the suns' mask by the minimum. */
export function encodeSunRayTraced(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  cam: EngineCamera,
  settings: ShadowValues,
  rays: SceneRays,
  suns: readonly SunRayTraced[],
  views: readonly GPUTextureView[],
) {
  const { device } = rt.gpu
  if (!device) return
  if (!suns.length) return
  const out = merger.layersFor(
    rt.gpu,
    device,
    rt.gpu.allocatedSize,
    suns.length,
    true,
    rt.run.frame,
  )
  const denoised: ShadowDenoiseJob[] = []
  suns.forEach((sun, k) =>
    traceInto(rt, encoder, settings, rays, views, out, k, sun, undefined, denoised, {
      key: sun.key,
      sun: { mask: sun.mask, slot: sun.slot },
    }),
  )
  // The suns come here only where the denoiser can run (`canDenoise`), so each traced layer is denoised and taken into the mask: no second trace.
  encodeShadowDenoise(rt, encoder, cam, settings, denoised)
}
