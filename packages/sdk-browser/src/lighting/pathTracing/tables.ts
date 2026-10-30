import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { glassEnergyWords } from '../../../../sdk-core/src/lighting/glassEnergy.ts'
import { shadingEnergyWords } from '../../../../sdk-core/src/lighting/shadingEnergy.ts'
import { sheenLtcHalves } from '../../../../sdk-core/src/lighting/sheenLtc.ts'
import { PT_GRID_BUILD_BINDINGS } from './buildPrograms.ts'
import type { PathTracingGpu } from './gpuState.ts'
import { PT_GLASS_AT, PT_LIGHT_TABLE_WORDS, PT_SHEEN_AT } from './lightTable.ts'
import { PT_LIGHT_FLOATS, type PathTracingLights } from './lightRecords.ts'
import type { PathTracingPipelines } from './pipelines.ts'

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
