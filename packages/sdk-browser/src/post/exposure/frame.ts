import { environmentExposure } from '../../../../sdk-core/src/scene/core/environment.ts'
import {
  exposureCurveScaleTable,
  exposureCurveTable,
} from '../../../../sdk-core/src/contracts/exposureCurveTable.ts'
import {
  EXPOSURE_RULES,
  cachedPreExposure,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { resolveSettingsStamped } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { wantsContractLighting } from '../../frame/prepare/lit.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { VIEW_LAYOUT } from '../../lighting/deferred/worldAtWgsl.ts'
import { showsRaw } from '../../visibility/shader/shadeMode.ts'
import {
  EXPOSURE_CURVE_SAMPLES,
  resolveExposureCurve,
} from '../../../../sdk-core/src/contracts/exposureCurve.ts'
import { createExposureMeter } from './meter.ts'
import { askExposurePrograms, exposureProgramsReady } from './meterPrograms.ts'
import type { PreExposure } from './pre.ts'
import type { MeterInput } from './meterRun.ts'

/** The byte of the composition's view uniform that holds the scale it multiplies the image by: the
 *  exposure over the image's pre-exposure, the second word of `preExposure` (`VIEW_LAYOUT`). */
export const EXPOSURE_AT = (VIEW_LAYOUT.at.preExposure + 1) * 4
/** The settings of the view, read again by each call into one object. */
const resolved = {} as ExposureValues

/** The exposure's settings, resolved from the view's context: the one place they are read, by the
 *  meter, the finishing and what asks their programs. The object is the same at each call. */
export const exposureSettings = (rt: Pick<WebgpuPagesRuntime, 'context'>) => (
  resolveSettingsStamped(EXPOSURE_RULES, rt.context, resolved),
  resolved
)

/** The pre-exposure the cached lighting is kept multiplied by (`cachedLightingPreExposure`): the sky light's
 *  capture and the surface cache's pages hold their light under it. */
export const cachedLightingPreExposureOf = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  cachedPreExposure(exposureSettings(rt).cachedLightingPreExposure)

/** The table of the view's exposure compensation curve (`exposureCurve`; ones where it names none),
 *  the same array while the option is the same object. */
export const exposureCurveOf = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  exposureCurveTable(rt.context.exposureCurve)

/** The tables the meter reads, joined (compensation, then the highlights' and the shadows' contrast scale), by the view's context:
 *  the parts they were made from, and the array, made again when any part is another. */
const joined = new WeakMap<
  object,
  {
    parts: Float32Array[]
    table: Float32Array
    curved: boolean
    contrast: [Float32Array, Float32Array]
  }
>()

/** The view's three curve tables as the meter's uniform holds them: the same array while no curve option is replaced. */
function exposureCurvesOf(rt: Pick<WebgpuPagesRuntime, 'context'>) {
  const { context } = rt
  const parts = [
    exposureCurveTable(context.exposureCurve),
    exposureCurveScaleTable(context.localExposureHighlightContrastCurve),
    exposureCurveScaleTable(context.localExposureShadowContrastCurve),
  ]
  let held = joined.get(context)
  if (!held || parts.some((part, k) => part !== held!.parts[k])) {
    const table = new Float32Array(parts.length * EXPOSURE_CURVE_SAMPLES)
    parts.forEach((part, k) => table.set(part, k * EXPOSURE_CURVE_SAMPLES))
    const curved = [
      context.localExposureHighlightContrastCurve,
      context.localExposureShadowContrastCurve,
    ].some((option) => resolveExposureCurve(option) !== null)
    joined.set(context, (held = { parts, table, curved, contrast: [parts[1], parts[2]] }))
  }
  return held.table
}

/** The view's two contrast curve tables, highlights then shadows, for an exposure the engine holds (`manualExposure`). */
export function contrastTablesOf(rt: Pick<WebgpuPagesRuntime, 'context'>) {
  exposureCurvesOf(rt)
  return joined.get(rt.context)!.contrast
}

/** Whether the view sets a local exposure contrast curve: the local exposure then runs whatever the contrasts (`localExposureOn`). */
export function localCurvesSet(rt: Pick<WebgpuPagesRuntime, 'context'>) {
  exposureCurvesOf(rt)
  return joined.get(rt.context)!.curved
}

/** The metering mask the page set, none where it set none. */
const meterMaskOf = (rt: Pick<WebgpuPagesRuntime, 'context'>) =>
  rt.context.exposureMeterMask ?? undefined

/** Whether the view's exposure is the meter's measure: the automatic one, by a method that
 *  measures the image. A fixed exposure, a number, and the manual method are held, not measured
 *  (`heldExposureOf`). */
export const exposureMeasured = (rt: Pick<WebgpuPagesRuntime, 'lights' | 'context'>) =>
  environmentExposure(rt.lights.store?.environment) === 'auto' &&
  exposureSettings(rt).exposureMethod !== 'manual'

/** Asks the meter's programs of `device` off the frame once an image needs them, the frame held
 *  until they landed (`../../frame/loop/framePipelines.ts`): the measure of the view's method,
 *  where the view's exposure is measured and lit. */
export function askExposure(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (wantsContractLighting(rt)) askMeter(rt, device)
}

/** The meter's programs, where the view's exposure is measured, lit or not yet (`askGlobalPasses`). */
export function askMeter(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (exposureMeasured(rt))
    askExposurePrograms(device, exposureSettings(rt).exposureMethod === 'basic')
}

/** What the image hands the meter, rewritten by each image: an image allocates none. */
const meterInput = {} as MeterInput

/** The world's time, in seconds, at the image: the one the material graphs read
 *  (`WebgpuRun.graphClocks`), taken once from the world's own clock (`EngineContext.worldClock`),
 *  else from the image clock. */
const clockOf = (rt: WebgpuPagesRuntime) => rt.run.graphClocks.time

/** Whether the view's exposure is still moving toward what its image asks, or its settings have
 *  changed since the last image, so a view that rests is drawn again
 *  (`../../frame/loop/unsettled.ts`). A view with no meter has none to wait for, nor a view that
 *  shows raw values or is not lit, which `encodeExposure` does not meter: a setting changed there
 *  would stay changed. */
export function exposureMoving(rt: WebgpuPagesRuntime) {
  const meter = rt.gpu.exposure
  if (!meter || !wantsContractLighting(rt) || showsRaw(rt.run.diagnostic)) return false
  return meter.moving || meter.changed(exposureSettings(rt), exposureCurvesOf(rt), meterMaskOf(rt))
}

/**
 * The exposure of the image composition reads, in the frame's encoder, before the composition: the
 * image `image` of `size` pixels measured as it is — radiance multiplied by the pre-exposure, no
 * exposure applied, the temporal resolve's when it ran —, or the exposure the engine holds (a
 * number, the manual method) written into the same buffer, and either copied, over the pre-exposure,
 * into the composition's uniform (`createExposureMeter`). `scene` is the chain begun on the image
 * (`beginFinishScene`), whose half-size image the histogram reads and the basic method draws its
 * grid from. Nothing for an unlit view or one
 * the diagnostics show in raw values (`raw`). While the measure's programs are not compiled the
 * image is shown at the exposure the CPU knows over the pre-exposure (`PreExposure.shown`). The meter is made at the first image that
 * needs it. `settings` are the image's (`exposureSettings`), read once for the finishing as well;
 * `pre` its pre-exposure (`preExposureOf`).
 */
export function encodeExposure(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  scene: SceneChain | undefined,
  image: GPUTextureView,
  size: readonly number[],
  raw: boolean,
  settings: ExposureValues,
  pre: PreExposure,
) {
  const { gpu } = rt
  if (raw || !wantsContractLighting(rt) || !gpu.deferred || size[0] < 1 || size[1] < 1) return
  const meter = (gpu.exposure ??= createExposureMeter(device))
  meterInput.image = image
  meterInput.scene = scene
  meterInput.size = size
  meterInput.settings = settings
  meterInput.curve = exposureCurvesOf(rt)
  meterInput.curved = localCurvesSet(rt)
  meterInput.cut = rt.run.gate.temporalRevision
  meterInput.preExposure = pre.now
  meterInput.clock = clockOf(rt)
  meterInput.mask = meterMaskOf(rt)
  const basic = settings.exposureMethod === 'basic'
  if (pre.held) meter.hold(encoder, meterInput, pre.held, gpu.deferred.uniform, EXPOSURE_AT)
  else if (scene && exposureProgramsReady(device, basic))
    meter.encode(encoder, meterInput, gpu.deferred.uniform, EXPOSURE_AT)
}
