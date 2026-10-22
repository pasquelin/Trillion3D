import { makeFullscreenPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import {
  computeSamplerEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { BLOOM_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'
import { filterPrograms, type FilterPairs } from '../../filters/filterPrograms.ts'
import { finishLayout } from '../../finish/finishLayout.ts'
import {
  BLOOM_COMPOSITE_WGSL,
  BLOOM_LOOK_BYTES,
  BLOOM_SETUP_WGSL,
  COMPOSITE_BINDINGS,
} from './bloomWgsl.ts'

/** The filters the bloom draws through: the downsample and the blur, in the format of its levels. */
const BLOOM_FILTERS: FilterPairs = [
  ['halve', HDR_FORMAT],
  ['halveWide', HDR_FORMAT],
  ['blurTaps', HDR_FORMAT],
]

/**
 * The bloom's programs once a device, compiled together off the thread: the setup, which reads
 * the half-size image through the filters' own layout and the finishing's group, and the
 * composite, which adds the glow, with its dirt mask, to the image a pass of the chain follows,
 * and the light the image gave up to it; and the filters the
 * bloom draws through (`../../filters/filterPrograms.ts`), prepared with them.
 */
export async function createBloomPrograms(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const filters = filterPrograms(device)
  const compositeLayout = device.createBindGroupLayout({
    label: `${BLOOM_PASS} composite`,
    entries: [
      computeTextureEntry(COMPOSITE_BINDINGS.scene, 'unfilterable-float', '2d', fragment),
      computeTextureEntry(COMPOSITE_BINDINGS.glow, 'float', '2d', fragment),
      computeSamplerEntry(COMPOSITE_BINDINGS.reader, 'filtering', fragment),
      computeTextureEntry(COMPOSITE_BINDINGS.mask, 'float', '2d', fragment),
      computeUniformEntry(COMPOSITE_BINDINGS.look, { minBindingSize: BLOOM_LOOK_BYTES }, fragment),
    ],
  })
  const [setupModule, compositeModule] = await Promise.all([
    createCheckedShaderModule(device, BLOOM_SETUP_WGSL, `${BLOOM_PASS} setup`),
    createCheckedShaderModule(device, BLOOM_COMPOSITE_WGSL, `${BLOOM_PASS} composite`),
  ])
  const targets = [{ format: HDR_FORMAT }]
  const prepared = filters.prepare(BLOOM_FILTERS)
  const [setup, composite] = await Promise.all([
    makeFullscreenPipeline(
      device,
      setupModule,
      [filters.layouts.down, finishLayout(device)],
      'bloomSetup',
      targets,
    ),
    makeFullscreenPipeline(device, compositeModule, compositeLayout, 'composite', targets),
  ])
  await prepared
  return { setup, composite, compositeLayout, filters }
}
