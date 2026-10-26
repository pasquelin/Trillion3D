import { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import {
  BLOCK_STRIDE,
  CUBE_FACES,
  FILTER_GROUP_SIDE,
  capturedIrradianceMip,
  groupsOver,
  irradianceMip,
} from './layout.ts'
import { writeBlock } from './captureInputs.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'

/**
 * THE CAPTURE'S COMPUTE STAGES over the cube: the mips, the filter by roughness and the harmonics'
 * sum, from the filtered cube (the real-time capture's) or from the captured cube's mips before the
 * filter (a captured scene's, a specified cubemap's). Each dispatch reads a block of the filter
 * buffer at a slot of its own, `slot` counting them in a frame (`beginFrame`).
 */
export interface FilterStage {
  readonly device: GPUDevice
  /** The stages that follow one another, one compute pass but on a frame timed per pass: begun on
   *  the frame's encoder by the caller (`encodeRealTime`, `finishCapture`). */
  readonly steps: ComputeRun
  readonly pipelines: SkyLightPipelines['pipelines']
  /** The next free slot of the filter blocks. */
  slot: number
  readonly words: Uint32Array
}

export const createFilterStage = (
  device: GPUDevice,
  pipelines: SkyLightPipelines['pipelines'],
): FilterStage => ({
  device,
  steps: new ComputeRun(),
  pipelines,
  slot: 0,
  words: new Uint32Array(4),
})

const MIPS_PASS: GPUComputePassDescriptor = { label: 'Trillion3D sky light mips' }
const FILTER_PASS: GPUComputePassDescriptor = { label: 'Trillion3D sky light filter' }
const HARMONICS_PASS: GPUComputePassDescriptor = { label: 'Trillion3D sky light harmonics' }

/** A filtering block's slot, written: `mip`, the cube's mips, the first face. */
function filterSlot(stage: FilterStage, t: SkyLightTargets, mip: number, faceFirst: number) {
  stage.words.set([mip, t.mips, faceFirst, 0])
  const at = stage.slot++ * BLOCK_STRIDE
  writeBlock(stage.device, t.blocks.filter, at, stage.words)
  return at
}

/** Mips `1` to the last, each from the one above, by `pipeline` over `groups[mip]`. */
function downsampleMips(
  stage: FilterStage,
  t: SkyLightTargets,
  pipeline: GPUComputePipeline | undefined,
  groups: readonly (GPUBindGroup | undefined)[],
) {
  if (!pipeline) return
  const pass = stage.steps.pass(MIPS_PASS)
  pass.setPipeline(pipeline)
  for (let mip = 1; mip < t.mips; mip++) {
    pass.setBindGroup(0, groups[mip]!, [filterSlot(stage, t, mip, 0)])
    const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
    pass.dispatchWorkgroups(side, side, CUBE_FACES)
  }
}

/** Mips `1` to the last of the captured cube, each from the one above. */
export const mipChain = (stage: FilterStage, t: SkyLightTargets) =>
  downsampleMips(stage, t, stage.pipelines.downsample.get(), t.groups.downsample)

/** Mips `mipFirst` to `mipLast` of filtered cube `w`, faces `faceFirst` for `faceCount`. */
export function filter(
  stage: FilterStage,
  t: SkyLightTargets,
  w: 0 | 1,
  mipFirst: number,
  mipLast: number,
  faceFirst: number,
  faceCount: number,
) {
  const pipeline = stage.pipelines.convolve.get()
  if (!pipeline) return
  const pass = stage.steps.pass(FILTER_PASS)
  pass.setPipeline(pipeline)
  for (let mip = mipFirst; mip <= mipLast; mip++) {
    pass.setBindGroup(0, t.groups.convolve[w][mip], [filterSlot(stage, t, mip, faceFirst)])
    const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
    pass.dispatchWorkgroups(side, side, faceCount)
  }
}

/** The harmonics' sum over `group`, reading the cube at `mip`. */
function sumHarmonics(
  stage: FilterStage,
  t: SkyLightTargets,
  mip: number,
  pipeline: GPUComputePipeline | undefined,
  group: GPUBindGroup,
) {
  if (!pipeline) return
  stage.words.set([mip, 0, 0, 0])
  writeBlock(stage.device, t.blocks.irradiance, 0, stage.words)
  const pass = stage.steps.pass(HARMONICS_PASS)
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(1)
}

/** The harmonics set `w` from filtered cube `w`. */
export const harmonics = (stage: FilterStage, t: SkyLightTargets, w: 0 | 1) =>
  sumHarmonics(
    stage,
    t,
    irradianceMip(t.width),
    stage.pipelines.irradiance.get(),
    t.groups.irradiance[w],
  )

/** The harmonics set `w` from the captured cube's mips, which are made (`mipChain`). */
const capturedHarmonics = (stage: FilterStage, t: SkyLightTargets, w: 0 | 1) =>
  sumHarmonics(
    stage,
    t,
    capturedIrradianceMip(t.mips),
    stage.pipelines.capturedIrradiance.get(),
    t.groups.capturedIrradiance[w],
  )

/** The mips of the captured cube, the harmonics set `w` summed from them and the filtered cube
 *  `w`: the end of a specified cubemap's capture and of a captured scene's. */
export function finishCapture(
  stage: FilterStage,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  w: 0 | 1,
) {
  stage.steps.begin(encoder)
  mipChain(stage, t)
  capturedHarmonics(stage, t, w)
  filter(stage, t, w, 0, t.mips - 1, 0, CUBE_FACES)
  stage.steps.end()
}
