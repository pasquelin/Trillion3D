import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { EXPOSURE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { filterPrograms } from '../filters/filterPrograms.ts'
import { BASIC_GRID_LEVEL, createBasicSetup } from './basicSetup.ts'
import type { MeterBuffers } from './meterBuffers.ts'
import { createMeterMask } from './meterMask.ts'
import { meterPrograms, type MeterPrograms } from './meterPrograms.ts'
import type { MeterInput } from './meterRun.ts'

const PASS = { label: EXPOSURE_PASS }

/** What the update's compute pass runs: the measure's pipeline over its group, `workgroups` of it. */
type MeasureRun = {
  pipeline: { get(): GPUComputePipeline | undefined }
  group: GPUBindGroup
  workgroups: number
}

/**
 * The group of the measure over an image and a mask, kept for each of the few the meter is given
 * in turn: with the temporal resolve the image alternates, so one group is not enough, and none is
 * made per frame. `mask` is the metering mask's view, the empty image where none is set. `clear`
 * forgets them all, so none holds a texture that is given back.
 */
function measureGroupsOver(device: GPUDevice, programs: MeterPrograms, buffers: MeterBuffers) {
  const identity = createWebgpuBindIdentity(4),
    groups: GPUBindGroup[] = [],
    filters = filterPrograms(device)
  return {
    of(image: GPUTextureView, mask: GPUTextureView | undefined) {
      identity.next[0] = image
      identity.next[1] = mask
      if (identity.moved())
        groups[identity.slot] = device.createBindGroup({
          layout: programs.measureLayout,
          entries: sequentialEntries([
            image,
            { buffer: buffers.uniform },
            { buffer: buffers.histogram },
            mask ?? filters.empty,
            filters.clamped,
          ]),
        })
      return groups[identity.slot]
    },
    clear() {
      identity.clear()
      groups.length = 0
    },
  }
}

/**
 * THE MEASURE OF THE METER'S METHOD: what the update's compute pass runs before the update, from
 * the image — the histogram's, one workgroup a row of the scene's half-size image, or the basic
 * method's, the last level of the scene's chain, drawn from the setup's image, and one workgroup over it —, with the metering mask's
 * texture where the page set one. `of` gives it, rewritten at each call; the basic method's setup image
 * is made at the first image of the method and given back when another takes over.
 */
export function createMeasure(device: GPUDevice, buffers: MeterBuffers) {
  const programs = meterPrograms(device)
  const mask = createMeterMask(device)
  const groups = measureGroupsOver(device, programs, buffers)
  const run = {} as MeasureRun
  let basic: ReturnType<typeof createBasicSetup> | undefined
  let measuringBasic = false
  const leaveBasic = () => {
    basic?.dispose()
    basic = undefined
    measuringBasic = false
    groups.clear()
  }
  return {
    /** The basic method's setup for the scene's chain (`SceneChain.begin`'s `logLuma`): drawn when the chain draws its
     *  quarter-size level, from the meter's uniform. Made at the first call and kept while the method holds. */
    logLuma(
      encoder: GPUCommandEncoder,
      quarter: GPUTextureView,
      size: readonly number[],
    ): GPUTextureView | undefined {
      basic ??= createBasicSetup(device, programs)
      return basic.encode(encoder, quarter, size, buffers.uniform)
    },
    of(encoder: GPUCommandEncoder, input: MeterInput, rows: number): MeasureRun | undefined {
      const maskView = input.mask ? mask.view(input.mask) : undefined
      if (!input.mask) mask.release()
      if (input.settings.exposureMethod !== 'basic') {
        if (basic || measuringBasic) leaveBasic()
        run.pipeline = programs.measure
        const scene = input.scene!
        scene.need(1)
        run.group = groups.of(scene.view(0)!, maskView)
        run.workgroups = rows
        return run
      }
      measuringBasic = true
      // The chain's last level, the setup's alpha averaged down: none while the setup is not compiled.
      const scene = input.scene!
      scene.need(BASIC_GRID_LEVEL + 1)
      const grid = scene.logged ? scene.view(BASIC_GRID_LEVEL) : undefined
      if (!grid) return undefined
      run.pipeline = programs.basic
      run.group = groups.of(grid, maskView)
      run.workgroups = 1
      return run
    },
    dispose() {
      mask.release()
      leaveBasic()
    },
  }
}

/** Encodes the update's compute pass: the measure `run`, then the exposure it asks. The measure's
 *  words are cleared first. Nothing while the measure or the exposure is not compiled: the
 *  exposure would be adapted to words nothing measured. */
export function encodeMeterPass(
  encoder: GPUCommandEncoder,
  programs: MeterPrograms,
  buffers: MeterBuffers,
  run: MeasureRun | undefined,
) {
  const measure = run?.pipeline.get()
  const adapt = programs.adapt.get()
  if (!run || !measure || !adapt) return
  encoder.clearBuffer(buffers.histogram)
  const pass = encoder.beginComputePass(PASS)
  pass.setPipeline(measure)
  pass.setBindGroup(0, run.group)
  pass.dispatchWorkgroups(run.workgroups)
  pass.setPipeline(adapt)
  pass.setBindGroup(0, buffers.adaptGroupOf(programs))
  pass.dispatchWorkgroups(1)
  pass.end()
}
