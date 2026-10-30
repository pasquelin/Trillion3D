import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { skyLightReadBindEntries, type SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import { PT_SKY_BINDINGS } from '../pathTracing/buildPrograms.ts'
import { SKY_TABLE_BLOCK, type SkyTable } from './skyTable.ts'
import { skyTableStagesOf } from './skyTableStages.ts'

/**
 * The sky's table `table` made from the sky light's cube (`set`): the radiance and the density of every cell of the equal-area map (`ptSkyPrepare`), the density's mip chain down to the one
 * texel of its mean (`ptSkyMip`), and, where the MIS compensation is on, the density less its mean (`ptSkyCompensate`) and the chain again. False while a pipeline is still compiling.
 */
export function encodeSkyTable(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  table: SkyTable,
  set: SkyLightReadSet,
  compensate: boolean,
  label: string,
) {
  const { layouts, stages: set3 } = skyTableStagesOf(device)
  const stages = [set3.prepare.get(), set3.mip.get(), set3.compensate.get()]
  if (stages.some((stage) => !stage)) return false
  const { size, mips } = table
  const sizes = new Uint32Array((SKY_TABLE_BLOCK / 4) * (mips + 1))
  for (let level = 0; level <= mips; level++)
    sizes[(level * SKY_TABLE_BLOCK) / 4] = Math.max(size >> Math.min(level, mips), 1)
  device.queue.writeBuffer(table.build, 0, sizes)
  const pdfLevel = (level: number) =>
    table.pdf.createView({ baseMipLevel: level, mipLevelCount: 1 })
  const sky = device.createBindGroup({
    layout: layouts[0],
    entries: skyLightReadBindEntries(PT_SKY_BINDINGS, set),
  })
  const build = (block: number, out: number, source: number) =>
    device.createBindGroup({
      layout: layouts[1],
      entries: [
        {
          binding: 0,
          resource: { buffer: table.build, offset: block * SKY_TABLE_BLOCK, size: 16 },
        },
        { binding: 1, resource: table.radianceView },
        { binding: 2, resource: pdfLevel(out) },
        { binding: 3, resource: pdfLevel(source) },
      ],
    })
  const pass = encoder.beginComputePass({ label })
  const run = (stage: GPUComputePipeline, group: GPUBindGroup, level: number) => {
    pass.setPipeline(stage)
    pass.setBindGroup(0, sky)
    pass.setBindGroup(1, group)
    const groups = ceilDiv(Math.max(size >> level, 1), 8)
    pass.dispatchWorkgroups(groups, groups)
  }
  const chain = () => {
    for (let level = 1; level < mips; level++)
      run(stages[1]!, build(level, level, level - 1), level)
  }
  run(stages[0]!, build(0, 0, 1), 0)
  chain()
  if (compensate) {
    run(stages[2]!, build(0, 0, mips - 1), 0)
    chain()
  }
  pass.end()
  return true
}
