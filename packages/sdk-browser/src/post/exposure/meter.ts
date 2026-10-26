import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'
import type { HeldExposure } from '../../../../sdk-core/src/contracts/exposureManual.ts'
import type { ExposureMeterMaskImage } from '../../../../sdk-core/src/contracts/exposureMeterMask.ts'
import type { ExposureValues } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { meterPrograms } from './meterPrograms.ts'
import { createMeterBuffers, type MeterBuffers } from './meterBuffers.ts'
import { createMeasure, encodeMeterPass } from './meterMeasure.ts'
import {
  meterWriter,
  noteImage,
  runChanged,
  startingRun,
  writeHeld,
  type MeterInput,
} from './meterRun.ts'
import { GREY_AT, LOCAL_AT, READBACK_BYTES, SHOWN_AT } from './meterLayout.ts'

/** Exposures that can be in flight back to the CPU at once: one an image, never a wait. */
const IN_FLIGHT = 3
/** How near, in stops, the exposure is to what the image asks for to be called settled: far under
 *  what an 8-bit display tells apart (a stop is a doubling, a byte step at mid grey a thirtieth
 *  of one). */
const SETTLED_STOPS = 1 / 256
/** Images drawn at the most while waiting for the first readback: past them, a device that never
 *  brings one back no longer keeps the view drawing. */
const WAIT_IMAGES = 16
/** A view's automatic exposure (`createExposureMeter`). */
export type ExposureMeter = ReturnType<typeof createExposureMeter>

/** What the last readback said — the exposure and the one its mean asked, 0 before any came
 *  back, and the local exposure's mean gain, 1 before —, the number of the exposures the engine
 *  held since (`holds`, the tag of each copy: a copy taken before the last hold says an exposure
 *  that is no longer the view's) and the ring that brings it. */
function createMeterReadback(device: GPUDevice) {
  const read = { last: 0, asked: 0, local: 1, holds: 0 }
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D exposure readback', bytes: READBACK_BYTES, count: IN_FLIGHT },
    (mapped, _, taken) => {
      const values = new Float32Array(mapped, 0, 3)
      if (taken !== read.holds || !(values[0] > 0 && values[1] > 0)) return
      read.last = values[0]
      read.asked = values[1]
      read.local = values[2] > 0 ? values[2] : 1
    },
  )
  return { read, ring }
}

/** Whether the exposure is still moving toward what the image asks, `images` of them measured: none
 *  has come back yet (for `WAIT_IMAGES` images at most), or it lies more than `SETTLED_STOPS` from
 *  it. A view that is moving is drawn again. */
function readbackMoving({ last, asked }: { last: number; asked: number }, images: number) {
  if (last === 0) return images < WAIT_IMAGES
  return Math.abs(Math.log2(last / asked)) > SETTLED_STOPS
}

/**
 * The meter's update of its exposure buffer and what comes with it: the measure and the update
 * (`encode`), then the scale shown copied into the view's uniform and the words into the readback's
 * staging buffer; or the exposure the engine holds written by the CPU where it changed (`hold`),
 * and the scale shown copied into the view's uniform alone: the CPU knows the exposure, nothing
 * comes back.
 */
function createMeterUpdate(
  device: GPUDevice,
  buffers: MeterBuffers,
  ring: ReadbackRing,
  read: { holds: number },
) {
  const measure = createMeasure(device, buffers)
  const run = startingRun()
  const writeMeter = meterWriter(device, buffers.uniform, run)
  // The curve table the GPU holds, which is not the one the last image saw when that was a held one.
  let uploaded: Float32Array | undefined
  /** The exposure buffer's scale shown into the view `view` at byte `at`. */
  const show = (encoder: GPUCommandEncoder, view: GPUBuffer, at: number) =>
    encoder.copyBufferToBuffer(buffers.exposure, SHOWN_AT, view, at, 4)
  /** The scale shown, and the exposure buffer's words to the readback. */
  const leave = (encoder: GPUCommandEncoder, view: GPUBuffer, at: number) => {
    show(encoder, view, at)
    const staging = ring.take(read.holds)
    if (staging) {
      encoder.copyBufferToBuffer(buffers.exposure, 0, staging, 0, 8)
      encoder.copyBufferToBuffer(buffers.exposure, LOCAL_AT, staging, 8, 4)
    }
  }
  return {
    run,
    /** Encodes the update of the image `input` hands, in one compute pass, its exposure over its
     *  pre-exposure copied into `view` — the composition's uniform — at byte `at`, and its
     *  exposure to the readback. The curve's table is written to the GPU when it is not the one
     *  the meter holds. */
    encode(encoder: GPUCommandEncoder, input: MeterInput, view: GPUBuffer, at: number) {
      if (input.curve !== uploaded) {
        device.queue.writeBuffer(buffers.curve, 0, input.curve as Float32Array<ArrayBuffer>)
        uploaded = input.curve
      }
      const rows = writeMeter(input)
      encodeMeterPass(encoder, meterPrograms(device), buffers, measure.of(encoder, input, rows))
      leave(encoder, view, at)
    },
    /** Writes the exposure `held` into the buffer, as the update would have left it, where it
     *  differs from what the buffer holds, and copies the scale shown into the view: no program
     *  runs, no copy to the readback. */
    hold(
      encoder: GPUCommandEncoder,
      input: MeterInput,
      held: HeldExposure,
      view: GPUBuffer,
      at: number,
    ) {
      noteImage(run, input)
      writeHeld(device, buffers.exposure, held, input.preExposure, run)
      show(encoder, view, at)
    },
    dispose: measure.dispose,
  }
}

/**
 * A VIEW'S EXPOSURE BUFFER, THE ONE SOURCE OF WHAT THE IMAGE IS SHOWN AT, MEASURED ON THE GPU AND
 * READ BACK A FEW IMAGES LATE. The image the composition reads — radiance multiplied by the image's
 * pre-exposure, before exposure — goes through the measure (the histogram's or the basic method's)
 * and the update (`meterWgsl.ts`) in one compute pass (`encode`); an exposure the engine holds
 * without measuring, a number or the manual method, is written into the same buffer by the CPU
 * (`hold`). Either way the exposure over the pre-exposure is copied, on the GPU, into the
 * composition's view uniform, so the image is shown at the exposure it was given, no frame late,
 * and the local exposure's middle grey into the finishing's (`copyGrey`); the exposure goes also
 * into a staging buffer of the engine's one readback ring (`createReadbackRing`), which brings it
 * to the CPU a few images later: `last`, the exposure the CPU's own readers use.
 * No frame waits for it, and an image whose staging buffers are all in flight copies none.
 *
 * It adapts on the world's time (`MeterInput.clock`), starts from an exposure of 1 and jumps to its
 * target at its first update and at each view cut (`cut`), where the world holds no earlier
 * exposure to move from; a held exposure counts as an image, so a measuring method that follows it
 * adapts from it over a normal frame.
 */
export function createExposureMeter(device: GPUDevice) {
  const buffers = createMeterBuffers(device)
  const { read, ring } = createMeterReadback(device)
  const { run, encode, hold, dispose } = createMeterUpdate(device, buffers, ring, read)
  return {
    /** The exposure the last readback brought, 0 until one has. */
    get last() {
      return read.last
    },
    /** Whether the exposure is still moving toward what the image asks (`readbackMoving`). */
    get moving() {
      return readbackMoving(read, run.images)
    },
    /** The mean of the local exposure's gain the last readback brought, 1 until one has or where
     *  the local exposure does not run. */
    get local() {
      return read.local
    },
    /** Whether `settings`, the curve `curve` or the mask `mask` are not the ones the last image
     *  saw: the view is drawn again to show them, a still image being held otherwise. */
    changed: (
      settings: ExposureValues,
      curve: Float32Array,
      mask: ExposureMeterMaskImage | undefined,
    ) => runChanged(run, settings, curve, mask),
    encode,
    /** The exposure the engine holds, `held`, written for the image (`createMeterUpdate`): the
     *  CPU knows it — what the readback would bring is it — so `last`, the one asked and the
     *  local mean are set at once, and the copies still on their way are of exposures no longer
     *  held. */
    hold(
      encoder: GPUCommandEncoder,
      input: MeterInput,
      held: HeldExposure,
      view: GPUBuffer,
      at: number,
    ) {
      hold(encoder, input, held, view, at)
      read.last = read.asked = held.exposure
      read.local = 1
      read.holds++
    },
    /** Copies the log2 of the middle grey the local exposure pulls toward — the update's or the
     *  held exposure's — `at` bytes into `into`: the finishing's uniform. */
    copyGrey(encoder: GPUCommandEncoder, into: GPUBuffer, at: number) {
      encoder.copyBufferToBuffer(buffers.exposure, GREY_AT, into, at, 4)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    dispose() {
      ring.destroy()
      dispose()
      buffers.dispose()
    },
  }
}
