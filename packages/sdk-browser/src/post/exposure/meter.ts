import { cpuNow } from '../../diagnostic/stopwatch.ts'
import { EXPOSURE_RULES } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { settingsDiffer } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { createReadbackRing } from '../../gpu/core/readbackRing.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { meterPrograms } from './meterPrograms.ts'
import { writeMeterParams, type ExposureSettings } from './meterParams.ts'
import { EXPOSURE_BYTES, HISTOGRAM_WORDS, METER_PARAMS } from './meterLayout.ts'

/** Exposures that can be in flight back to the CPU at once: one an image, never a wait. */
const IN_FLIGHT = 3
/** How near, in stops, the exposure is to what the image asks for to be called settled: far under
 *  what an 8-bit display tells apart (a stop is a doubling, a byte step at mid grey a thirtieth
 *  of one). */
const SETTLED_STOPS = 1 / 256
/** Images drawn at the most while waiting for the first readback: past them, a device that never
 *  brings one back no longer keeps the view drawing. */
const WAIT_IMAGES = 16
/** What the pass starts from, and the reference's own: an exposure of 1 asking 1. */
const START = new Float32Array([1, 1, 1, 1])
const PASS = { label: EXPOSURE_PASS }

/** A view's automatic exposure (`createExposureMeter`). */
export type ExposureMeter = ReturnType<typeof createExposureMeter>

type MeterPrograms = ReturnType<typeof meterPrograms>

/** The meter's buffers — its uniform, the histogram, the exposure it leaves, started at 1 — and the
 *  group of the update, which reads the first two and writes the third. */
function createMeterBuffers(device: GPUDevice, programs: MeterPrograms) {
  const label = 'Trillion3D exposure meter v1'
  const uniform = device.createBuffer({
    label,
    size: METER_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const histogram = device.createBuffer({
    label,
    size: HISTOGRAM_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const exposure = device.createBuffer({
    label,
    size: EXPOSURE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(exposure, 0, START)
  const adaptGroup = device.createBindGroup({
    layout: programs.adaptLayout,
    entries: sequentialEntries([{ buffer: uniform }, { buffer: histogram }, { buffer: exposure }]),
  })
  return {
    uniform,
    histogram,
    exposure,
    adaptGroup,
    dispose() {
      uniform.destroy()
      histogram.destroy()
      exposure.destroy()
    },
  }
}

type MeterBuffers = ReturnType<typeof createMeterBuffers>

/** The group of the measure over an image, kept for each of the few images the meter is given in
 *  turn: with the temporal resolve the image alternates, so one group is not enough, and none is
 *  made per frame. */
function measureGroupsOver(
  device: GPUDevice,
  programs: MeterPrograms,
  { uniform, histogram }: MeterBuffers,
) {
  const identity = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = []
  return (image: GPUTextureView) => {
    identity.next[0] = image
    if (identity.moved())
      groups[identity.slot] = device.createBindGroup({
        layout: programs.measureLayout,
        entries: sequentialEntries([image, { buffer: uniform }, { buffer: histogram }]),
      })
    return groups[identity.slot]
  }
}

/** The update's compute pass: the histogram of the image (`measure`, one workgroup a row of
 *  half-resolution pixels, `rows` of them), then the exposure it asks. */
function encodeMeterPass(
  encoder: GPUCommandEncoder,
  programs: MeterPrograms,
  buffers: MeterBuffers,
  measure: GPUBindGroup,
  rows: number,
) {
  encoder.clearBuffer(buffers.histogram)
  const pass = encoder.beginComputePass(PASS)
  pass.setPipeline(programs.measure.get())
  pass.setBindGroup(0, measure)
  pass.dispatchWorkgroups(rows)
  pass.setPipeline(programs.adapt.get())
  pass.setBindGroup(0, buffers.adaptGroup)
  pass.dispatchWorkgroups(1)
  pass.end()
}

/** What the last readback said — the exposure and the one its mean asked, 0 before any came
 *  back — and the ring that brings it. */
function createMeterReadback(device: GPUDevice) {
  const read = { last: 0, asked: 0 }
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D exposure readback', bytes: EXPOSURE_BYTES, count: IN_FLIGHT },
    (mapped) => {
      const values = new Float32Array(mapped, 0, 2)
      if (!(values[0] > 0 && values[1] > 0)) return
      read.last = values[0]
      read.asked = values[1]
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
 * A VIEW'S AUTOMATIC EXPOSURE, MEASURED ON THE GPU, READ BACK A FEW IMAGES LATE. The image the
 * composition reads — radiance, before exposure — goes through the histogram and the update
 * (`meterWgsl.ts`) in one compute pass; the exposure it leaves is copied, on the GPU, into the
 * composition's view uniform, so the image is shown at the exposure it measured, no frame late,
 * and into a staging buffer of the engine's one readback ring (`createReadbackRing`), which brings
 * it to the CPU a few images later: `last`, the exposure the CPU's own readers use
 * (`applied.ts`). No frame waits for it, and an image whose staging buffers are all in flight
 * copies none.
 *
 * It starts from an exposure of 1 and jumps to its target at its first update and at each view cut
 * (`cut`), where the world holds no earlier exposure to move from.
 */
export function createExposureMeter(device: GPUDevice) {
  const programs = meterPrograms(device)
  const buffers = createMeterBuffers(device, programs)
  const measureGroupOf = measureGroupsOver(device, programs, buffers)
  const { read, ring } = createMeterReadback(device)
  const words = new Float32Array(METER_PARAMS.words),
    ints = new Uint32Array(words.buffer)
  const run = {
    seen: undefined as number | undefined,
    at: -1,
    images: 0,
    used: {} as ExposureSettings,
  }
  return {
    /** The exposure the last readback brought, 0 until one has. */
    get last() {
      return read.last
    },
    /** Whether the exposure is still moving toward what the image asks (`readbackMoving`). */
    get moving() {
      return readbackMoving(read, run.images)
    },
    /** Whether `settings` are not the ones the last update ran with: the view is drawn again to
     *  show them, a still image being held otherwise. */
    changed: (settings: ExposureSettings) => settingsDiffer(EXPOSURE_RULES, run.used, settings),
    /** Encodes the update of the image `image` of `size` pixels, in one compute pass, its exposure
     *  copied into `view` — the composition's uniform — at byte `at` and to the readback. A change
     *  of `cut`, the view's camera cut, jumps the exposure to its target. */
    encode(
      encoder: GPUCommandEncoder,
      image: GPUTextureView,
      size: readonly number[],
      settings: ExposureSettings,
      cut: number | undefined,
      view: GPUBuffer,
      at: number,
    ) {
      const now = cpuNow()
      const seconds = run.at < 0 ? 0 : (now - run.at) / 1000
      writeMeterParams(words, ints, settings, size, seconds, run.at < 0 || cut !== run.seen)
      run.at = now
      run.seen = cut
      run.images++
      Object.assign(run.used, settings)
      device.queue.writeBuffer(buffers.uniform, 0, words)
      const rows = ints[METER_PARAMS.at.size + 3]
      encodeMeterPass(encoder, programs, buffers, measureGroupOf(image), rows)
      encoder.copyBufferToBuffer(buffers.exposure, 0, view, at, 4)
      const staging = ring.take()
      if (staging) encoder.copyBufferToBuffer(buffers.exposure, 0, staging, 0, EXPOSURE_BYTES)
    },
    /** After the image's submit: its copy maps. */
    submitted: () => ring.submitted(),
    dispose() {
      ring.destroy()
      buffers.dispose()
    },
  }
}
