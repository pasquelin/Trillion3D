import type { AmbientOcclusionSettings } from '../../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { putCamera, putTarget, type AoImage } from '../params.ts'
import { HORIZON_PARAMS } from './layout.ts'
import { horizonScaleOf, type HorizonPass, type HorizonTarget } from './plan.ts'
import { HORIZON_STEP_OFFSETS, HORIZON_TURNS_DEGREES } from './tables.ts'

/** What the history is this image: the rectangle it was drawn in (one where there is none), whether the surfaces' vectors of
 *  motion are bound, and where this image's clip positions fell in the last image's (column-major). */
export interface HorizonFrame {
  historyRect: readonly number[]
  vectors: boolean
  clipToPrevious: ArrayLike<number>
}

/** The reduction of `target` at the search's `downscale`, none for none. */
const scaleOf = (target: HorizonTarget | undefined, downscale: number) =>
  target && horizonScaleOf(target, downscale)

/** The turn of the directions and the phase of the steps' offsets this image: the image's rank over six and over four — a
 *  paused jitter holds the first image's. */
function putNoise(out: Float32Array, at: number, count: number, frame: number) {
  const rank = Math.trunc(frame)
  const turn = (HORIZON_TURNS_DEGREES[rank % HORIZON_TURNS_DEGREES.length] * DEG2RAD) / 2
  const phase =
    HORIZON_STEP_OFFSETS[
      Math.trunc(rank / HORIZON_TURNS_DEGREES.length) % HORIZON_STEP_OFFSETS.length
    ] * 0.25
  putVec4(out, at, Math.cos(turn), Math.sin(turn), phase, Math.trunc(count))
}

/**
 * Writes the uniform of `pass` into `out` (`HORIZON_PARAMS`): the camera, the rectangles of the pass and of what it reads,
 * the search's radius, thickness, reach in pixels and falloff, the turn of this image's directions, the angle between two
 * and the temporal filter's blend, the fade, the spatial filter's tail and reach, the history's rectangle and the motion
 * from this image to the last.
 */
export function writeHorizonParams(
  out: Float32Array,
  pass: HorizonPass,
  settings: AmbientOcclusionSettings,
  image: AoImage,
  frame: HorizonFrame,
  terms: Float32Array,
) {
  const at = HORIZON_PARAMS.at
  const { horizon } = settings
  putCamera(out, at, image, terms)
  putTarget(out, at.rects, scaleOf(pass.target, horizon.downscale), image, true)
  putTarget(out, at.input, scaleOf(pass.input, horizon.downscale), image, true)
  const radius = horizon.radiusCm
  putVec4(
    out,
    at.search,
    radius,
    horizon.thickness,
    image.view[1] * image.projection[0],
    2 / (radius * radius),
  )
  putNoise(out, at.angles, horizon.angles, horizon.pauseJitter ? 0 : image.noiseIndex)
  const delta = Math.PI / horizon.angles
  putVec4(out, at.delta, Math.sin(delta), Math.cos(delta), horizon.blend, +frame.vectors)
  putVec4(
    out,
    at.fade,
    settings.fadeMultiplier,
    settings.fadeAddend,
    settings.fadeDistanceCm,
    horizon.downscale,
  )
  putVec4(
    out,
    at.tail,
    settings.power * 0.5,
    settings.intensity,
    horizon.filterFirst,
    horizon.filterLast,
  )
  putVec4(out, at.history, frame.historyRect[0], frame.historyRect[1])
  putVec4(out, at.mode, +(pass.kind === 'upsample' && !horizon.spatial))
  out.set(frame.clipToPrevious, at.clip)
}
