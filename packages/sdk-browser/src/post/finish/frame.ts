import { environmentVignette } from '../../../../sdk-core/src/scene/core/environment.ts'
import {
  EXPOSURE_RULES,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { FILM_RULES, type FilmValues } from '../../../../sdk-core/src/contracts/filmOptions.ts'
import {
  GAUSSIAN_BLUR_RULES,
  type GaussianBlurValues,
} from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import {
  resolveSettingsStamped,
  settingsDiffer,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import { beautyImage, wantsContractLighting } from '../../frame/prepare/lit.ts'
import { wanted } from './wanted.ts'
import { noiseFrame } from '../../frame/render/noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import {
  EXPOSURE_AT,
  exposureMeasured,
  exposureSettings,
  localCurvesSet,
} from '../exposure/frame.ts'
import { createExposureMeter } from '../exposure/meter.ts'
import { preExposureOf } from '../exposure/pre.ts'
import { localExposureOn } from '../exposure/meterParams.ts'
import type { FusedBlend } from '../effects/webgpuKinds.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { createFinish, GREY_BYTE, SCALES_BYTE, type PostFrame } from './finish.ts'
import { grainOn } from './filmParams.ts'
import { lensOf, type FinishInput } from './finishParams.ts'
import { askLocalPrograms, localProgramsReady } from './local.ts'
import { filmSettings } from './settings.ts'
import { askToneTable, toneMoving } from './toneFrame.ts'

/** What the finishing's uniform is written from, refilled at each image. */
const written: FinishInput = {
  settings: {} as ExposureValues,
  film: {} as FilmValues,
  vignette: 0,
  lens: lensOf(null),
  local: false,
  glow: false,
  size: [0, 0],
  grain: false,
  frame: 0,
}
/** What the frame's passes share, refilled at each image: an image allocates none. */
const shared = {} as PostFrame
/** The lens of the image's camera where it draws a tile, rewritten in place (`lensOf`). */
const tileLens: number[] = [0, 0, 1, 1]
/** The Gaussian blur settings of the view, read again by each call into one object. */
const resolvedBlur = {} as GaussianBlurValues

/** The Gaussian blur's settings, resolved from the view's context: the local exposure's blurred
 *  luminance is blurred by them as the bloom's levels are (the bloom reads them with its own). */
const blurSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsStamped(GAUSSIAN_BLUR_RULES, rt.context, resolvedBlur)

/** Whether the composition that carries the finishing — the local exposure, the bloom's glow and
 *  the vignette — is compiled: the first call starts its compile, and its failure is told to the
 *  view's diagnostics. False where the view has no lighting yet. */
export function composesFinish(rt: WebgpuPagesRuntime) {
  return !!rt.gpu.deferred?.composesFinish(rt.diag.diagnosticFailure)
}

/** Asks the programs an image needs of `device` off the frame: the tone table's baking once a lit
 *  image reads it, the local exposure's once its settings ask for it, the frame held until they
 *  landed (`../../frame/loop/framePipelines.ts`). */
export function askFinish(rt: WebgpuPagesRuntime, device: GPUDevice) {
  askToneTable(rt, device)
  if (wanted(rt)) askLocalExposure(rt, device)
}

/** The local exposure's programs once its settings ask for it, on the beauty image, lit or not yet (`askGlobalPasses`). */
export function askLocalExposure(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (beautyImage(rt) && localExposureOn(exposureSettings(rt), localCurvesSet(rt)))
    askLocalPrograms(device)
}

/** Whether the finishing's film grain is drawn: its pattern follows the image's number, so a view
 *  that rests is drawn again at each image, as the reference draws every one
 *  (`../../frame/loop/hold.ts`). The dither's pattern follows it too, on every image that is
 *  drawn; a view that rests keeps the pattern of its last image. Its held image holds the 8-bit
 *  values that dither made, and a new noise added to them would average, over the images, to those
 *  values and not to the light (`film.test.ts` runs the two); a new pattern at rest needs the
 *  image composed again from its light, which is what a session opened with `drawConverged` does. */
export const finishAnimated = (rt: WebgpuPagesRuntime) => wanted(rt) && grainOn(filmSettings(rt))

/** Whether the finishing still has something to show: the tone table is not the one its settings
 *  ask for (`toneMoving`), the composition that carries the finishing is not compiled, or its
 *  settings are not the ones the last image was drawn with, so a view that rests is drawn again
 *  (`../../frame/loop/unsettled.ts`). */
export function finishMoving(rt: WebgpuPagesRuntime) {
  const { gpu } = rt
  if (toneMoving(rt)) return true
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
 * Begins the scene's chain on the image `image` of `size` pixels, before the exposure is metered:
 * the chain is the finishing's, and the exposure meter reads its half-size image (the basic
 * method draws its grid from the same levels), once; `half`, the image's half-size image where the pass that made it wrote that beside it. None for an unlit view, a view shown in raw values (`raw`) or one with no lighting yet, and
 * for one that is neither finished (`wanted`) nor metered: nothing draws from it.
 * The finishing is made at the first image that asks.
 */
export function beginFinishScene(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  image: GPUTextureView,
  size: readonly number[],
  raw: boolean,
  half?: GPUTextureView,
): SceneChain | undefined {
  const { gpu } = rt
  if (raw || !wantsContractLighting(rt) || !gpu.deferred || size[0] < 1 || size[1] < 1)
    return undefined
  if (!exposureMeasured(rt) && !wanted(rt)) return undefined
  const finish = (gpu.finish ??= createFinish(device))
  const wide = readTemporalSetting(rt, 'temporalDownsampleQuality') === 'high'
  // The basic exposure method's setup goes into the chain as the reference's does, so that one chain serves every reader.
  const settings = exposureSettings(rt)
  const basic = exposureMeasured(rt) && settings.exposureMethod === 'basic'
  const meter = basic ? (gpu.exposure ??= createExposureMeter(device)) : undefined
  finish.scene.begin(encoder, image, size[0], size[1], half, wide, meter?.logLuma)
  // The local exposure's grid and blurred luminance are drawn here, before the exposure is metered: they read the chain, never the exposure.
  finish.localDrawn =
    wanted(rt) && localExposureOn(settings, localCurvesSet(rt)) && localProgramsReady(device)
  if (finish.localDrawn)
    finish.local.encode(
      encoder,
      finish.scene,
      settings.localExposureBlurSize,
      settings.localExposureBlurBlend > 0,
      blurSettings(rt),
    )
  return finish.scene
}

/**
 * The display finishing's passes on the chain `scene` (`beginFinishScene`), in the frame's encoder,
 * after the exposure it is shown at is known and before the effect chain: the exposure and the
 * middle grey of the local exposure, both from the exposure buffer, copied into the finishing's
 * uniform, and — where the settings ask for a local exposure and its programs are compiled — its
 * layers drawn. Returns what the passes after it share (`PostFrame`); nothing for a view the
 * finishing leaves as it is, or the metering found nothing to finish (`scene` none). `settings` are
 * the image's (`exposureSettings`), read once for the meter as well; the film's (`filmSettings`)
 * are read here, once, and kept in the finishing for the group (`finishedGroup`) and for the next
 * image's comparison (`finishMoving`).
 */
export function encodeFinish(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: SceneChain | undefined,
  settings: ExposureValues,
): PostFrame | undefined {
  const { gpu } = rt
  if (!scene || !wanted(rt) || !gpu.deferred || !gpu.finish) return undefined
  const finish = gpu.finish
  Object.assign(finish.used, settings)
  Object.assign(finish.usedFilm, filmSettings(rt))
  Object.assign(finish.usedBlur, blurSettings(rt))
  written.settings = settings
  written.preExposure = preExposureOf(rt).now
  finish.copyExposure(encoder, gpu.deferred.uniform, EXPOSURE_AT)
  gpu.exposure?.copyGrey(encoder, finish.uniform, GREY_BYTE)
  gpu.exposure?.copyScales(encoder, finish.uniform, SCALES_BYTE)
  const local = finish.localDrawn
  finish.localDrawn = false
  shared.scene = scene
  shared.uniform = finish.uniform
  shared.bare = finish.bare
  shared.layers = finish.groupFor(local)
  shared.local = local
  shared.lens = lensOf(rt.run.gate.cam.viewTile, tileLens)
  return shared
}

/**
 * The group the composition reads to finish the image: the local exposure's layers, the bloom's
 * `blend` the effect chain left — its glow, the dirt mask over it, what it leaves of the image's
 * light —, the grain's texture where the grain is drawn, and the uniform
 * written from the settings of the image (`encodeFinish` read them once) and its number, which the
 * grain's pattern and the dither follow. The dither is always drawn, as the reference always
 * draws it: a lit image is never composed plain. None while the composition that carries the
 * finishing compiles (`finishPending`: the image is drawn without it, and drawn again once it has).
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
  if (!composesFinish(rt)) {
    gpu.finishPending = true
    return undefined
  }
  written.film = film
  written.vignette = vignette
  written.local = post.local
  written.glow = !!blend
  written.keep = blend?.keeps ? blend.keep : undefined
  written.dirt = blend?.mask ? blend.factor : undefined
  written.size = post.scene.imageSize
  written.lens = post.lens
  written.grain = grain
  written.frame = noiseFrame(rt)
  finish.write(written)
  return finish.groupFor(post.local, blend?.glow, grain, blend?.mask)
}
