import { sharedGpuDevice } from '../gpu/core/sessionHandle.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { COVERAGE_CHOOSE_WGSL, COVERAGE_COUNT_WGSL } from './mipsWgsl.ts'
import { preparedComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import {
  sequentialEntries,
  computeBufferEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../gpu/core/computeBindings.ts'

/** Bytes of one level's 256 bins. */
export const LEVEL_BIN_BYTES = 1024

/** The counts' program, built once per device — the shared one (`sharedGpuDevice`), as the mips'
 *  (`mips.ts`) —, its two pipelines compiled off the thread (`prepareCoveragePipelines`): `count`
 *  over a chain's level, `pick` over a batch's level (`COVERAGE_CHOOSE_WGSL`), its level block
 *  bound at a dynamic offset. */
const coverageProgram = oncePerDevice((device: GPUDevice) => {
  const visibility = GPUShaderStage.COMPUTE
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(0, 'float', '2d', visibility),
      computeBufferEntry(1, 'uniform', visibility),
      computeBufferEntry(2, 'storage', visibility),
    ],
  })
  const chooseLayout = device.createBindGroupLayout({
    entries: [
      computeUniformEntry(0, { hasDynamicOffset: true }, visibility),
      computeBufferEntry(1, 'read-only-storage', visibility),
      computeBufferEntry(2, 'storage', visibility),
    ],
  })
  const pipeline = (code: string, bindGroupLayout: GPUBindGroupLayout, entryPoint: string) =>
    preparedComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module: device.createShaderModule({ code }), entryPoint },
    })
  return {
    layout,
    chooseLayout,
    count: pipeline(wgslModule(COVERAGE_COUNT_WGSL), layout, 'count'),
    pick: pipeline(COVERAGE_CHOOSE_WGSL, chooseLayout, 'choose'),
  }
})

/** Compiles off the thread, before a colour texture's mips cut its coverage, the counts' two
 *  pipelines on `device`'s shared cache. */
export function prepareCoveragePipelines(device: GPUDevice) {
  const { count, pick } = coverageProgram(sharedGpuDevice(device))
  return Promise.all([count.prepare(), pick.prepare()]).then(() => {})
}

/** What a chain's counts read: its levels' views, the uniform blocks of `generateMaterialMips`,
 *  one per level from block `first`, and the chain's own bins, cleared. */
export type CoverageChain = {
  views: GPUTextureView[]
  uniforms: GPUBuffer
  first: number
  stride: number
  bins: GPUBufferBinding
}

/** The count groups of `chain`'s `levels` levels: at 0 level 0's own count (block 0 over view 0),
 *  at `k` level `k`'s, block `k` over view `k − 1`; made once per chain and batch place
 *  (`mipGroups.ts`). */
export function coverageGroups(device: GPUDevice, chain: CoverageChain, levels: number) {
  const { layout } = coverageProgram(sharedGpuDevice(device))
  const { views, uniforms, first, stride, bins } = chain
  return Array.from({ length: levels }, (_, block) =>
    device.createBindGroup({
      layout,
      entries: sequentialEntries([
        views[Math.max(0, block - 1)],
        { buffer: uniforms, offset: (first + block) * stride, size: 32 },
        bins,
      ]),
    }),
  )
}

/** The counts' two pipelines on `device`'s shared cache: `count` files a level's texels in its
 *  bins, `pick` leaves its `t` in bin 0, where the level's reduction reads it
 *  (`MATERIAL_MIP_WGSL`): nothing copied, nothing waits outside the chains' compute pass. */
export function coveragePipelines(device: GPUDevice) {
  const { count, pick } = coverageProgram(sharedGpuDevice(device))
  return { count: count.get(), pick: pick.get() }
}

/** The picks' group of a batch, by its uniforms: their level blocks and table, and the bins. */
const picked = new WeakMap<GPUBuffer, { bins: GPUBuffer; group: GPUBindGroup }>()

/** The group the picks of a batch over `uniforms` and `bins` bind (`COVERAGE_CHOOSE_WGSL`), its
 *  level block at a dynamic offset: made again only when either buffer is. */
export function pickGroup(device: GPUDevice, uniforms: GPUBuffer, bins: GPUBuffer) {
  const held = picked.get(uniforms)
  if (held?.bins === bins) return held.group
  const group = device.createBindGroup({
    layout: coverageProgram(sharedGpuDevice(device)).chooseLayout,
    entries: sequentialEntries([
      { buffer: uniforms, size: 16 },
      { buffer: uniforms },
      { buffer: bins },
    ]),
  })
  picked.set(uniforms, { bins, group })
  return group
}
