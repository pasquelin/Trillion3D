import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { litImageShown } from '../../frame/prepare/contractLight.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { filmSettings } from '../finish/frame.ts'
import { appliedExposureOf, averageLocalExposureOf } from './applied.ts'
import { exposureSettings } from './frame.ts'

/**
 * THE PRE-EXPOSURE OF AN IMAGE: the number every light the image holds is multiplied by as it is
 * written, so that the half floats it is stored in keep their range at any exposure, and that the
 * composition divides back out (`shown`, the exposure over it). It is the exposure of the image
 * before — the one the CPU knows (`appliedExposureOf`) — times the luminance of the scene colour
 * tint and the local exposure's mean gain (`averageLocalExposureOf`), or the number `preExposureOverride` names; 1 for a view that is not lit, that shows raw
 * values or that runs no post (a capture), and for every view with `preExposure` off.
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
}

/** The pre-exposure of a view that has begun none. */
const UNIT: PreExposure = Object.freeze({ now: 1, previous: 1, shown: 1 })
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
 *  shows raw values or runs no post; else the override, else the exposure times the tint's
 *  luminance (held above 0.0001, as a tint of black would divide by zero) times the local
 *  exposure's mean gain. */
function preExposureNow(rt: WebgpuPagesRuntime) {
  const settings = exposureSettings(rt)
  if (!settings.preExposure || !litImageShown(rt) || !rt.views.active.overrides.post) return 1
  if (settings.preExposureOverride > 0) return Math.max(settings.preExposureOverride, LEAST)
  return Math.max(
    appliedExposureOf(rt) * Math.max(tintLuminance(rt), 1e-4) * averageLocalExposureOf(rt),
    LEAST,
  )
}

/** The pre-exposure of the view's image: the one `beginPreExposure` fixed, 1 before it. */
export const preExposureOf = (rt: Pick<WebgpuPagesRuntime, 'gpu'>): PreExposure =>
  states.get(rt.gpu) ?? UNIT

/**
 * Fixes the pre-exposure of the image about to be encoded, once, before any pass writes light: the
 * last one becomes the image before's. Every writer and every reader of what is kept reads it from
 * `preExposureOf` for the whole image.
 */
export function beginPreExposure(rt: WebgpuPagesRuntime) {
  let state = states.get(rt.gpu)
  if (!state) states.set(rt.gpu, (state = { now: 1, previous: 1, shown: 1 }))
  state.previous = state.now
  state.now = preExposureNow(rt)
  state.shown = appliedExposureOf(rt) / state.now
  return state
}
