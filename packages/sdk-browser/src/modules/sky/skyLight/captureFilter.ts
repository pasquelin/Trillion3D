import { BLOCK_STRIDE, CUBE_FACES, FILTER_GROUP_SIDE, groupsOver, irradianceMip } from './layout.ts'
import { writeBlock } from './captureInputs.ts'
import type { SkyLightPipelines } from './pipelines.ts'
import type { SkyLightTargets } from './targets.ts'

/**
 * THE CAPTURE'S COMPUTE STAGES over the cube: the mips, the filter by roughness and the harmonics'
 * sum. Each dispatch reads a block of the filter buffer at a slot of its own, `slot` counting them
 * in a frame (`beginFrame`).
 */
export interface FilterStage {
  readonly device: GPUDevice
  readonly pipelines: SkyLightPipelines['pipelines']
  /** The next free slot of the filter blocks. */
  slot: number
  readonly words: Uint32Array
}

export const createFilterStage = (
  device: GPUDevice,
  pipelines: SkyLightPipelines['pipelines'],
): FilterStage => ({ device, pipelines, slot: 0, words: new Uint32Array(4) })

/** A filtering block's slot, written: `mip`, the cube's mips, the first face. */
export function filterSlot(stage: FilterStage, t: SkyLightTargets, mip: number, faceFirst: number) {
  stage.words.set([mip, t.mips, faceFirst, 0])
  const at = stage.slot++ * BLOCK_STRIDE
  writeBlock(stage.device, t.blocks.filter, at, stage.words)
  return at
}

/** Mips `1` to the last, each from the one above, by `pipeline` over `groups[mip]`. */
export function downsampleMips(
  stage: FilterStage,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  label: string,
  pipeline: GPUComputePipeline,
  groups: readonly (GPUBindGroup | undefined)[],
) {
  const pass = encoder.beginComputePass({ label })
  pass.setPipeline(pipeline)
  for (let mip = 1; mip < t.mips; mip++) {
    pass.setBindGroup(0, groups[mip]!, [filterSlot(stage, t, mip, 0)])
    const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
    pass.dispatchWorkgroups(side, side, CUBE_FACES)
  }
  pass.end()
}

/** Mips `1` to the last of the captured cube, each from the one above. */
export const mipChain = (stage: FilterStage, encoder: GPUCommandEncoder, t: SkyLightTargets) =>
  downsampleMips(
    stage,
    encoder,
    t,
    'Trillion3D sky light mips',
    stage.pipelines.downsample.get(),
    t.groups.downsample,
  )

/** Mips `mipFirst` to `mipLast` of filtered cube `w`, faces `faceFirst` for `faceCount`. */
export function filter(
  stage: FilterStage,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  w: 0 | 1,
  mipFirst: number,
  mipLast: number,
  faceFirst: number,
  faceCount: number,
) {
  const pass = encoder.beginComputePass({ label: 'Trillion3D sky light filter' })
  pass.setPipeline(stage.pipelines.convolve.get())
  for (let mip = mipFirst; mip <= mipLast; mip++) {
    pass.setBindGroup(0, t.groups.convolve[w][mip], [filterSlot(stage, t, mip, faceFirst)])
    const side = groupsOver(t.width >> mip, FILTER_GROUP_SIDE)
    pass.dispatchWorkgroups(side, side, faceCount)
  }
  pass.end()
}

/** The harmonics from filtered cube `w`. */
export function harmonics(
  stage: FilterStage,
  encoder: GPUCommandEncoder,
  t: SkyLightTargets,
  w: 0 | 1,
) {
  stage.words.set([irradianceMip(t.width), 0, 0, 0])
  writeBlock(stage.device, t.blocks.irradiance, 0, stage.words)
  const pass = encoder.beginComputePass({ label: 'Trillion3D sky light harmonics' })
  pass.setPipeline(stage.pipelines.irradiance.get())
  pass.setBindGroup(0, t.groups.irradiance[w])
  pass.dispatchWorkgroups(1)
  pass.end()
}
