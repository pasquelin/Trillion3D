import { environmentExposure } from '../../../../sdk-core/src/scene/core/environment.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { resolveSettingsInto } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { wantsContractLighting } from '../../frame/prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { VIEW_LAYOUT } from '../../lighting/deferred/worldAtWgsl.ts'
import { showsRaw } from '../../visibility/shader/shadeMode.ts'
import { createExposureMeter } from './meter.ts'
import { askExposurePrograms, meterPrograms } from './meterPrograms.ts'
import type { ExposureSettings } from './meterParams.ts'

/** The byte of the composition's view uniform that holds the exposure it multiplies by: the
 *  fourth word of the light parameters (`lightParams.w`, `VIEW_LAYOUT`). */
export const EXPOSURE_AT = (VIEW_LAYOUT.at.lightParams + 3) * 4
/** The settings of the view, read again by each call into one object. */
const resolved = {} as ExposureSettings

/** The exposure's settings, resolved from the view's context: the one place they are read, by the
 *  meter, the finishing and what asks their programs. The object is the same at each call. */
export const exposureSettings = (rt: WebgpuPagesRuntime) =>
  resolveSettingsInto(EXPOSURE_RULES, rt.context, resolved)

/** Whether the view's image is exposed by the meter: lit by declared lamps, its exposure the
 *  automatic one. A manual exposure, and a view that shows the raw albedo, need none. */
const meterWanted = (rt: WebgpuPagesRuntime) =>
  wantsContractLighting(rt) && environmentExposure(rt.lights.store.environment) === 'auto'

/** Asks the meter's programs of `device` off the frame once an image needs them, the frame held
 *  until they landed (`../../frame/loop/framePipelines.ts`). */
export function askExposure(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (meterWanted(rt)) askExposurePrograms(device)
}

/** Whether the view's exposure is still moving toward what its image asks, or its settings have
 *  changed since the last update, so a view that rests is drawn again
 *  (`../../frame/loop/unsettled.ts`). A view with no meter has none to wait for, nor a view that
 *  shows raw values, which `encodeExposure` does not meter: a setting changed there would stay
 *  changed. */
export function exposureMoving(rt: WebgpuPagesRuntime) {
  const meter = rt.gpu.exposure
  if (!meter || !meterWanted(rt) || showsRaw(rt.run.diagnostic)) return false
  return meter.moving || meter.changed(exposureSettings(rt))
}

/**
 * The exposure of the image composition reads, `image` of `size` pixels, in the frame's encoder,
 * before the composition: measured on the image as it is — radiance, no exposure applied, the
 * temporal resolve's when it ran —, and copied into the composition's uniform
 * (`createExposureMeter`). Nothing for a manual exposure, an unlit view, a view the diagnostics
 * show in raw values (`raw`), or while the programs are not compiled: the image is then shown at
 * the exposure the CPU knows (`appliedExposureOf`). The meter is made at the first image that needs
 * it. `settings` are the image's (`exposureSettings`), read once for the finishing as well.
 */
export function encodeExposure(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  image: GPUTextureView,
  size: readonly number[],
  raw: boolean,
  settings: ExposureSettings,
) {
  const { gpu } = rt
  if (raw || !meterWanted(rt) || !gpu.deferred || size[0] < 1 || size[1] < 1) return
  const { measure, adapt } = meterPrograms(device)
  if (!measure.ready || !adapt.ready) return
  const meter = (gpu.exposure ??= createExposureMeter(device))
  meter.encode(
    encoder,
    image,
    size,
    settings,
    rt.run.gate.temporalRevision,
    gpu.deferred.uniform,
    EXPOSURE_AT,
  )
}
