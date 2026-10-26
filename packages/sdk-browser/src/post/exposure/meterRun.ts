import type { ExposureMeterMaskImage } from '../../../../sdk-core/src/contracts/exposureMeterMask.ts'
import type { HeldExposure } from '../../../../sdk-core/src/contracts/exposureManual.ts'
import {
  EXPOSURE_RULES,
  type ExposureValues,
} from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { settingsDiffer } from '../../../../sdk-core/src/contracts/settingRules.ts'
import type { SceneChain } from '../filters/sceneChain.ts'
import { METER_PARAMS, SHOWN_AT } from './meterLayout.ts'
import { writeMeterParams, type MeterUniform } from './meterParams.ts'

/** What an image hands the meter, rewritten by each image: the image and the scene's chain begun
 *  on it (`SceneChain`: the basic method's grid is drawn from its levels, none for a method that draws
 *  none), the image's size in
 *  pixels, the exposure's settings, the table of the compensation curve (`exposureCurveTable`), the
 *  view's camera cut (a change of it jumps the exposure to its target), the pre-exposure the image
 *  holds its light multiplied by, the world's time in seconds at the image (`clock`: the
 *  adaptation moves by its difference between two images) and the metering mask, none where the
 *  page set none. */
export type MeterInput = {
  image: GPUTextureView
  scene: SceneChain | undefined
  size: readonly number[]
  settings: ExposureValues
  curve: Float32Array
  cut: number | undefined
  preExposure: number
  clock: number
  mask: ExposureMeterMaskImage | undefined
}

/** What the meter remembers of the images it saw, measured or held: the cut and the clock of the
 *  last, how many, the settings it ran with, the curve table and the mask it ran with (by
 *  identity), and the words a held exposure last wrote into the exposure buffer (`written`) with
 *  whether the buffer still holds them (`inBuffer`: a measuring image's update rewrites it). */
export type MeterRun = {
  seen: number | undefined
  clock: number
  images: number
  used: ExposureValues
  curve: Float32Array | undefined
  mask: ExposureMeterMaskImage | undefined
  written: Float32Array
  inBuffer: boolean
}

/** The meter's memory before any image. */
export const startingRun = (): MeterRun => ({
  seen: undefined,
  clock: 0,
  images: 0,
  used: {} as ExposureValues,
  curve: undefined,
  mask: undefined,
  written: new Float32Array(HELD_WORDS),
  inBuffer: false,
})

/** Whether the settings `now`, the curve `curve` or the mask `mask` are not the ones the last
 *  image `run` saw. */
export const runChanged = (
  run: MeterRun,
  now: ExposureValues,
  curve: Float32Array,
  mask: ExposureMeterMaskImage | undefined,
) => curve !== run.curve || mask !== run.mask || settingsDiffer(EXPOSURE_RULES, run.used, now)

/** Notes the image `input` in `run`: the next image's seconds are measured from its clock, and a
 *  held exposure counts as one, so that a switch to a measuring method adapts over a normal frame
 *  from the exposure shown. */
export function noteImage(run: MeterRun, input: MeterInput) {
  run.clock = input.clock
  run.seen = input.cut
  run.curve = input.curve
  run.mask = input.mask
  run.images++
  Object.assign(run.used, input.settings)
}

/**
 * The writer of the meter's uniform of each image, sent to its buffer `uniform`: the seconds of the
 * world's time since the last image (0 for the first), whether the exposure jumps (the first image
 * or a cut), the pre-exposure the image holds its light multiplied by. It answers the rows of
 * half-resolution pixels the histogram's measure dispatches.
 */
export function meterWriter(device: Pick<GPUDevice, 'queue'>, uniform: GPUBuffer, run: MeterRun) {
  const words = new Float32Array(METER_PARAMS.words),
    ints = new Uint32Array(words.buffer)
  const written = {} as MeterUniform
  return (input: MeterInput) => {
    const first = run.images === 0
    written.settings = input.settings
    written.size = input.size
    written.seconds = first ? 0 : input.clock - run.clock
    written.jumps = first || input.cut !== run.seen
    written.preExposure = input.preExposure
    written.masked = input.mask !== undefined
    writeMeterParams(words, ints, written)
    noteImage(run, input)
    // The update this image runs rewrites the exposure buffer: what a held exposure wrote is no longer in it.
    run.inBuffer = false
    device.queue.writeBuffer(uniform, 0, words)
    return ints[METER_PARAMS.at.size + 3]
  }
}

/** The words of the exposure buffer a held exposure writes: two `vec4f`. */
const HELD_WORDS = 8
/** The words of the image about to be compared with what the buffer holds. */
const next = new Float32Array(HELD_WORDS)

/**
 * Writes `held`, an exposure the engine holds without measuring it, into the meter's exposure
 * `buffer` as the update would leave it: the exposure and the one asked (the same), the mean, the
 * compensation; then the scale shown over the pre-exposure `preExposure`, a local mean of 1 and the
 * middle grey. The next measuring image starts from it. Only the words that differ from the ones
 * `run` last wrote go up — from the first to the last of them, in one write — and none while the
 * buffer still holds them: a held exposure that does not change does no work on the GPU.
 */
export function writeHeld(
  device: Pick<GPUDevice, 'queue'>,
  buffer: GPUBuffer,
  held: HeldExposure,
  preExposure: number,
  run: MeterRun,
) {
  next.set([held.exposure, held.exposure, held.mean, held.compensation])
  next.set([held.exposure / preExposure, 1, held.grey, 0], SHOWN_AT / 4)
  let first = HELD_WORDS,
    last = -1
  for (let k = 0; k < HELD_WORDS; k++)
    if (!run.inBuffer || next[k] !== run.written[k]) {
      if (first === HELD_WORDS) first = k
      last = k
    }
  if (last < 0) return
  run.written.set(next)
  run.inBuffer = true
  device.queue.writeBuffer(buffer, first * 4, next, first, last - first + 1)
}
