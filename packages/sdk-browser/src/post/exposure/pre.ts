import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { filmSettings } from '../finish/settings.ts'
import type { HeldExposure } from '../../../../sdk-core/src/contracts/exposureManual.ts'
import { UNIT_EXPOSURE } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { heldExposureOf } from './applied.ts'
import { exposureSettings } from './frame.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'

/**
 * THE PRE-EXPOSURE OF AN IMAGE: the number every light the image holds is multiplied by as it is
 * written, so that the half floats it is stored in keep their range at any exposure, and that the
 * composition divides back out (`shown`, the exposure over it). It is the exposure of the image
 * before — the one the CPU knows, read once here: a fixed or a manual exposure (`heldExposureOf`),
 * else the meter's last readback — times the luminance of the scene colour tint and the local
 * exposure's mean gain, or the number `preExposureOverride` names; 1 for a view that is not lit,
 * that shows raw values or that runs no post (a capture), and for every view with `preExposure` off.
 */
export interface PreExposure {
  /** The number every light of this image is multiplied by. */
  now: number
  /** The number of the image before, which what is kept from it (the temporal pass's history, the
   *  fog volume, the clouds, the reflections' image) was written with: 1 before any. */
  previous: number
  /** The exposure the CPU knows over `now`: what the composition multiplies the image by until the
   *  GPU has measured the image's own (`encodeExposure`). */
  shown: number
  /** The exposure the CPU knows for this image, read once: every reader of the exposure outside
   *  the composition takes it from here. */
  exposure: number
  /** The exposure the engine holds without measuring it, none where the meter measures the image:
   *  the meter writes it into its exposure buffer (`ExposureMeter.hold`). */
  held: HeldExposure | undefined
}

/** The pre-exposure of a view that has begun none. */
const UNIT: PreExposure = Object.freeze({
  now: 1,
  previous: 1,
  shown: 1,
  exposure: 1,
  held: undefined,
})
/** The least pre-exposure: the product of an exposure and a tint stays above it. */
const LEAST = 1e-6

const states = new WeakMap<object, PreExposure>()

/** The luminance of the scene colour tint, the working space's weights (the reference's too). */
function tintLuminance(rt: WebgpuPagesRuntime) {
  const film = filmSettings(rt)
  return (
    SRGB_LUMINANCE[0] * film.sceneColorTintRed +
    SRGB_LUMINANCE[1] * film.sceneColorTintGreen +
    SRGB_LUMINANCE[2] * film.sceneColorTintBlue
  )
}

/** The number this image is pre-exposed by: 1 where the setting is off or the view is not lit,
 *  shows raw values or runs no post; else the override, else the exposure `exposure` times the
 *  tint's luminance (held above 0.0001, as a tint of black would divide by zero) times the local
 *  exposure's mean gain, which only a measured image has (1 for a held exposure). */
function preExposureNow(rt: WebgpuPagesRuntime, { exposure, held }: PreExposure) {
  const settings = exposureSettings(rt)
  if (!settings.preExposure || !litImageShown(rt) || !rt.views.active.overrides.post) return 1
  if (settings.preExposureOverride > 0) return Math.max(settings.preExposureOverride, LEAST)
  const local = held ? 1 : (rt.gpu.exposure?.local ?? 1)
  return Math.max(exposure * Math.max(tintLuminance(rt), 1e-4) * local, LEAST)
}

/** The pre-exposure of the view's image: the one `beginPreExposure` fixed, 1 before it. */
export const preExposureOf = (rt: Pick<WebgpuPagesRuntime, 'gpu'>): PreExposure =>
  states.get(viewKey(rt.gpu)) ?? UNIT

/**
 * Fixes the pre-exposure of the image about to be encoded, once, before any pass writes light: the
 * last one becomes the image before's. Every writer and every reader of what is kept reads it from
 * `preExposureOf` for the whole image.
 */
export function beginPreExposure(rt: WebgpuPagesRuntime) {
  let state = states.get(viewKey(rt.gpu))
  if (!state)
    states.set(
      viewKey(rt.gpu),
      (state = { now: 1, previous: 1, shown: 1, exposure: 1, held: undefined }),
    )
  state.previous = state.now
  state.held = heldExposureOf(rt)
  state.exposure = state.held ? state.held.exposure : rt.gpu.exposure?.last || UNIT_EXPOSURE
  state.now = preExposureNow(rt, state)
  state.shown = state.exposure / state.now
  return state
}
