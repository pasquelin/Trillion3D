import {
  environmentExposure,
  environmentVignette,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { FILM_RULES, type FilmValues } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import {
  GAUSSIAN_BLUR_RULES,
  type GaussianBlurValues,
} from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import {
  resolveSettingsInto,
  settingsDiffer,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import { wantsContractLighting } from '../../frame/prepare/contractLight.ts'
import { beautyImage } from '../../frame/backend/state/renderScale.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { EXPOSURE_AT, exposureSettings } from '../exposure/frame.ts'
import type { ExposureSettings } from '../exposure/meterParams.ts'
import type { FusedBlend } from '../effects/webgpuKinds.ts'
import { createFinish, type PostFrame } from './finish.ts'
import { filmOn, grainOn, vignetteStrength } from './filmParams.ts'
import { localExposureOn, type FinishInput } from './finishParams.ts'
import { askLocalPrograms, localProgramsReady } from './local.ts'

/** What the finishing's uniform is written from, refilled at each image. */
const written: FinishInput = {
  settings: {} as ExposureSettings,
  film: {} as FilmValues,
  vignette: 0,
  auto: false,
  local: false,
  glow: false,
  size: [0, 0],
  grain: false,
  frame: 0,
}
/** What the frame's passes share, refilled at each image: an image allocates none. */
const shared = {} as PostFrame
/** The film settings of the view, read again by each call into one object. */
const resolvedFilm = {} as FilmValues
/** The Gaussian blur settings of the view, read again by each call into one object. */
const resolvedBlur = {} as GaussianBlurValues

/** The film effects' settings, resolved from the view's context: the one place they are read by
 *  the finishing. The object is the same at each call. */
const filmSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsInto(FILM_RULES, rt.context, resolvedFilm)

/** The Gaussian blur's settings, resolved from the view's context: the local exposure's blurred
 *  luminance is blurred by them as the bloom's levels are (the bloom reads them with its own). */
const blurSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsInto(GAUSSIAN_BLUR_RULES, rt.context, resolvedBlur)

/** Whether the composition that carries the finishing — the local exposure, the bloom's glow and
 *  the vignette — is compiled: the first call starts its compile, and its failure is told to the
 *  view's diagnostics. False where the view has no lighting yet. */
export function composesFinish(rt: WebgpuPagesRuntime) {
  return !!rt.gpu.deferred?.composesFinish(rt.diag.diagnosticFailure)
}

/** Whether the image is finished at all: lit by declared lamps and the beauty one. A view that
 *  shows the albedo, a diagnostic view and a capture show the image as it is. */
export const wanted = (rt: WebgpuPagesRuntime) => wantsContractLighting(rt) && beautyImage(rt)

/** Asks the local exposure's programs of `device` off the frame once an image needs them, the
 *  frame held until they landed (`../../frame/loop/framePipelines.ts`). */
export function askFinish(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (wanted(rt) && localExposureOn(exposureSettings(rt))) askLocalPrograms(device)
}

/** Whether the finishing still has something to show: the composition that carries it is not
 *  compiled, or its settings are not the ones the last image was drawn with, so a view that
 *  rests is drawn again (`../../frame/loop/unsettled.ts`). */
export function finishMoving(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  if (!wanted(rt)) return false
  if (gpu.finishPending) return true
  const finish = gpu.finish
  if (!finish) return false
  return (
    settingsDiffer(EXPOSURE_RULES, finish.used, exposureSettings(rt)) ||
    settingsDiffer(FILM_RULES, finish.usedFilm, filmSettings(rt)) ||
    settingsDiffer(GAUSSIAN_BLUR_RULES, finish.usedBlur, blurSettings(rt))
  )
}

/**
 * The display finishing's passes of the image `image` of `size` pixels, in the frame's encoder,
 * after the exposure it is shown at is known and before the effect chain: the exposure copied into
 * the finishing's uniform, the scene's chain begun on the image, and — where the settings ask for
 * a local exposure and its programs are compiled — its layers drawn. Returns what the passes after
 * it share (`PostFrame`); nothing for a view the finishing leaves as it is, or one shown in raw
 * values (`raw`). `settings` are the image's (`exposureSettings`), read once for the meter as well;
 * the film's (`filmSettings`) are read here, once, and kept in the finishing for the group
 * (`finishedGroup`) and for the next image's comparison (`finishMoving`).
 */
export function encodeFinish(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  image: GPUTextureView,
  size: readonly number[],
  raw: boolean,
  settings: ExposureSettings,
): PostFrame | undefined {
  const { gpu } = rt
  if (raw || !wanted(rt) || !gpu.deferred || size[0] < 1 || size[1] < 1) return undefined
  const finish = (gpu.finish ??= createFinish(device))
  Object.assign(finish.used, settings)
  Object.assign(finish.usedFilm, filmSettings(rt))
  Object.assign(finish.usedBlur, blurSettings(rt))
  written.settings = settings
  finish.copyExposure(encoder, gpu.deferred.uniform, EXPOSURE_AT)
  finish.scene.begin(encoder, image, size[0], size[1])
  const local = localExposureOn(settings) && localProgramsReady(device)
  if (local)
    finish.local.encode(
      encoder,
      finish.scene,
      settings.localExposureBlurSize,
      settings.localExposureBlurBlend > 0,
      finish.usedBlur,
    )
  shared.scene = finish.scene
  shared.uniform = finish.uniform
  shared.bare = finish.bare
  shared.layers = finish.groupFor(local)
  shared.local = local
  return shared
}

/**
 * The group the composition reads to finish the image: the local exposure's layers, the bloom's
 * `blend` the effect chain left — its glow, the dirt mask over it, what it leaves of the image's
 * light —, the grain's texture where the grain is drawn, and the uniform
 * written from the settings of the image (`encodeFinish` read them once) and its number, which the
 * grain's pattern and the dither follow. None where the finishing draws nothing — no local
 * exposure, no glow, no vignette, no fringe, grain, tint or dither: the plain composition —, and
 * while the composition that carries it compiles (`finishPending`: the image is drawn without it,
 * and drawn again once it has).
 */
export function finishedGroup(
  rt: WebgpuPagesRuntime,
  post: PostFrame | undefined,
  blend: FusedBlend | undefined,
) {
  const { gpu } = rt
  gpu.finishPending = false
  const { finish, deferred } = gpu
  if (!post || !finish || !deferred) return undefined
  const { environment } = rt.lights.store
  const film = finish.usedFilm
  const vignette = environmentVignette(environment)
  const grain = grainOn(film)
  if (!post.local && !blend && !(vignetteStrength(film, vignette) > 0) && !filmOn(film, grain))
    return undefined
  if (!composesFinish(rt)) {
    gpu.finishPending = true
    return undefined
  }
  written.film = film
  written.vignette = vignette
  written.auto = environmentExposure(environment) === 'auto'
  written.local = post.local
  written.glow = !!blend
  written.keep = blend?.keeps ? blend.keep : undefined
  written.dirt = blend?.mask ? blend.factor : undefined
  written.size = post.scene.imageSize
  written.grain = grain
  written.frame = rt.run.frame
  finish.write(written)
  return finish.groupFor(post.local, blend?.glow, grain, blend?.mask)
}
