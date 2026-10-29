import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { glassEnergyWords } from '../../../../sdk-core/src/lighting/glassEnergy.ts'
import { shadingEnergyWords } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { sheenLtcHalves } from '../../../../sdk-core/src/lighting/sheenLtc.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { PT_GRID_BUILD_BINDINGS, PT_SKY_BINDINGS } from './buildPrograms.ts'
import type { PathTracingGpu } from './gpuState.ts'
import { PT_GLASS_AT, PT_LIGHT_TABLE_WORDS, PT_SHEEN_AT } from './lightTable.ts'
import { PT_LIGHT_FLOATS, type PathTracingLights } from './lightRecords.ts'
import type { PathTracingPipelines } from './pipelines.ts'

/** Bytes between two blocks of the sky table's parameters: a uniform's offset alignment. */
const SKY_BLOCK = 256

/** The light grid's parameters (`PtGridParams`) as words: the box, the cells a side, the most lights a cell keeps, the axis (3 for the best of the three), the lights at infinity and all. */
export function gridParamWords(
  lights: PathTracingLights,
  resolution: number,
  maxCount: number,
  axis: number,
) {
  const words = new ArrayBuffer(64)
  const floats = new Float32Array(words)
  floats.set([...lights.boundMin, 0, ...lights.boundMax, 0])
  new Uint32Array(words).set(
    [resolution, maxCount, axis < 0 ? 3 : axis, lights.infinite, lights.count],
    8,
  )
  return words
}

/** The lights' buffer written: the energy, sheen and glass tables the materials read, then the records. */
export function writeLights(device: GPUDevice, gpu: PathTracingGpu, lights: PathTracingLights) {
  device.queue.writeBuffer(gpu.lights, 0, shadingEnergyWords())
  device.queue.writeBuffer(gpu.lights, PT_SHEEN_AT * 4, sheenLtcHalves())
  device.queue.writeBuffer(gpu.lights, PT_GLASS_AT * 4, glassEnergyWords())
  device.queue.writeBuffer(
    gpu.lights,
    PT_LIGHT_TABLE_WORDS * 4,
    lights.data,
    0,
    lights.count * PT_LIGHT_FLOATS,
  )
}

/** The light grid made for the lights `lights`: its parameters written, its kernel dispatched over the cells of the three axes. Nothing for a scene of lights at infinity alone. */
export function encodeLightGrid(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  lights: PathTracingLights,
  maxCount: number,
  axis: number,
) {
  device.queue.writeBuffer(
    gpu.gridParams,
    0,
    gridParamWords(lights, gpu.gridResolution, maxCount, axis),
  )
  const pipeline = pipelines.grid.get()
  if (!pipeline || lights.count === lights.infinite) return
  const B = PT_GRID_BUILD_BINDINGS
  const group = device.createBindGroup({
    layout: pipelines.gridLayout,
    entries: [
      { binding: B.params, resource: { buffer: gpu.gridParams } },
      { binding: B.lights, resource: { buffer: gpu.lights } },
      { binding: B.grid, resource: gpu.grid.createView({ dimension: '2d-array' }) },
      { binding: B.gridData, resource: gpu.gridData.createView() },
    ],
  })
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer light grid' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  const cells = ceilDiv(gpu.gridResolution, 8)
  pass.dispatchWorkgroups(cells, cells, 3)
  pass.end()
}

/**
 * The sky's table made from the sky light's cube (`set`): the radiance and the density of every cell of the equal-area map (`ptSkyPrepare`), the density's mip chain down to the one texel of
 * its mean (`ptSkyMip`), and, where the MIS compensation is on, the density less its mean (`ptSkyCompensate`) and the chain again.
 */
export function encodeSkyTable(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipelines: PathTracingPipelines,
  gpu: PathTracingGpu,
  set: SkyLightReadSet,
  compensate: boolean,
) {
  const { prepare, mip, compensate: reduce } = pipelines.sky
  const stages = [prepare.get(), mip.get(), reduce.get()]
  if (stages.some((stage) => !stage)) return false
  const { skySize, skyMips } = gpu
  const sizes = new Uint32Array((SKY_BLOCK / 4) * (skyMips + 1))
  for (let level = 0; level <= skyMips; level++)
    sizes[(level * SKY_BLOCK) / 4] = Math.max(skySize >> Math.min(level, skyMips), 1)
  device.queue.writeBuffer(gpu.skyBuild, 0, sizes)
  const pdfLevel = (level: number) =>
    gpu.skyPdf.createView({ baseMipLevel: level, mipLevelCount: 1 })
  const sky = device.createBindGroup({
    layout: pipelines.skyLayouts[0],
    entries: skyLightReadBindEntries(PT_SKY_BINDINGS, set),
  })
  const table = gpu.skyTexture.createView()
  const build = (block: number, out: number, source: number) =>
    device.createBindGroup({
      layout: pipelines.skyLayouts[1],
      entries: [
        { binding: 0, resource: { buffer: gpu.skyBuild, offset: block * SKY_BLOCK, size: 16 } },
        { binding: 1, resource: table },
        { binding: 2, resource: pdfLevel(out) },
        { binding: 3, resource: pdfLevel(source) },
      ],
    })
  const pass = encoder.beginComputePass({ label: 'Trillion3D path tracer sky table' })
  const run = (stage: GPUComputePipeline, group: GPUBindGroup, level: number) => {
    pass.setPipeline(stage)
    pass.setBindGroup(0, sky)
    pass.setBindGroup(1, group)
    const groups = ceilDiv(Math.max(skySize >> level, 1), 8)
    pass.dispatchWorkgroups(groups, groups)
  }
  const chain = () => {
    for (let level = 1; level < skyMips; level++)
      run(stages[1]!, build(level, level, level - 1), level)
  }
  run(stages[0]!, build(0, 0, 1), 0)
  chain()
  if (compensate) {
    run(stages[2]!, build(0, 0, skyMips - 1), 0)
    chain()
  }
  pass.end()
  return true
}
