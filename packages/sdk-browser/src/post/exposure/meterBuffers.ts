import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { EXPOSURE_CURVE_SAMPLES } from '../../../../sdk-core/src/contracts/exposureCurve.ts'
import { EXPOSURE_MIDDLE_GREY } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { MeterPrograms } from './meterPrograms.ts'
import { EXPOSURE_BYTES, EXPOSURE_CURVE_TABLES, METER_PARAMS, METER_WORDS } from './meterLayout.ts'

/** What the exposure buffer starts from, and the reference's own: an exposure of 1 asking 1, a
 *  compensation of 1, shown at 1, a local mean of 1 and the middle grey of that compensation. */
const START = new Float32Array([1, 1, 1, 1, 1, 1, Math.log2(EXPOSURE_MIDDLE_GREY), 0, 1, 1, 0, 0])

/** The meter's buffers — its uniform, the measure's words, the exposure it leaves, started at
 *  `START`, the curves' tables, the compensation's then the two contrast curves' — and the group of the update, which reads the first,
 *  the second and the last and writes the third (`adaptGroupOf`, made at the first update: a
 *  held exposure runs no program). */
export function createMeterBuffers(device: GPUDevice) {
  const label = 'Trillion3D exposure meter v1'
  const uniform = device.createBuffer({
    label,
    size: METER_PARAMS.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const histogram = device.createBuffer({
    label,
    size: METER_WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const exposure = device.createBuffer({
    label,
    size: EXPOSURE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  })
  const curve = device.createBuffer({
    label,
    size: EXPOSURE_CURVE_TABLES * EXPOSURE_CURVE_SAMPLES * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(exposure, 0, START)
  let adaptGroup: GPUBindGroup | undefined
  return {
    uniform,
    histogram,
    exposure,
    curve,
    adaptGroupOf: (programs: MeterPrograms) =>
      (adaptGroup ??= device.createBindGroup({
        layout: programs.adaptLayout,
        entries: sequentialEntries([
          { buffer: uniform },
          { buffer: histogram },
          { buffer: exposure },
          { buffer: curve },
        ]),
      })),
    dispose() {
      uniform.destroy()
      histogram.destroy()
      exposure.destroy()
      curve.destroy()
    },
  }
}

export type MeterBuffers = ReturnType<typeof createMeterBuffers>
