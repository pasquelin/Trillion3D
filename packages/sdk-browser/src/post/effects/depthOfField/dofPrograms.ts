import { preparedComputeStage } from '../../../gpu/core/computeStages.ts'
import { postSamplers } from '../../../gpu/core/postSamplers.ts'
import { preparedPipelines } from '../../../gpu/core/preparedPipelines.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { preparedPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { DEPTH_OF_FIELD_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { COLOR_FORMAT } from './dofLayout.ts'
import { dofLayouts } from './dofLayouts.ts'
import { DILATE_MODES, dilateShader, cocFlattenShader } from './dofTilesWgsl.ts'
import { cocDownsampleShader, setupFullShader, setupHalfShader } from './dofSetupWgsl.ts'
import { dofTemporalShader } from './dofTemporalWgsl.ts'
import { dofReduceShader } from './dofReduceWgsl.ts'
import { bokehLutShader } from './dofLutWgsl.ts'
import { dofGatherShader } from './dofGatherWgsl.ts'
import { dofPostfilterShader } from './dofPostfilterWgsl.ts'
import { packShader, spriteShader } from './dofScatterWgsl.ts'
import { dofRecombineShader } from './dofRecombineMainWgsl.ts'
import { layersLayout } from '../../../blend/translucencyLayers.ts'

/** What decides a pipeline of each pass: its pipeline constants, which name the layer, the rings,
 *  the quality, the bokeh, the tiles' dilation, the reduction's outputs. */
type Constants = Readonly<Record<string, number>>

/** The additive blend the scattered sprites are drawn with: one of each. */
const ADDITIVE: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
}

/** The shader modules, compiled and checked together, each under its pass's name (`ENTRIES`; the
 *  sprites' beside them). */
async function dofModules(device: GPUDevice) {
  const label = (name: string) => `${DEPTH_OF_FIELD_PASS} ${name}`
  const named = async <N extends string>(name: N, module: Promise<GPUShaderModule>) =>
    [name, await module] as const
  const compiled = await Promise.all([
    named('setupHalf', createCheckedShaderModule(device, setupHalfShader(), label('setup half'))),
    named('setupFull', createCheckedShaderModule(device, setupFullShader(), label('setup full'))),
    named('temporal', createCheckedShaderModule(device, dofTemporalShader(), label('temporal'))),
    named('flatten', createCheckedShaderModule(device, cocFlattenShader(), label('flatten'))),
    named('dilate', createCheckedShaderModule(device, dilateShader(), label('dilate'))),
    named(
      'downsample',
      createCheckedShaderModule(device, cocDownsampleShader(), label('downsample')),
    ),
    named('reduce', createCheckedShaderModule(device, dofReduceShader(), label('reduce'))),
    named('pack', createCheckedShaderModule(device, packShader(), label('pack'))),
    named('lut', createCheckedShaderModule(device, bokehLutShader(), label('table'))),
    named('gather', createCheckedShaderModule(device, dofGatherShader(), label('gather'))),
    named(
      'postfilter',
      createCheckedShaderModule(device, dofPostfilterShader(), label('post-filter')),
    ),
    named('sprites', createCheckedShaderModule(device, spriteShader(), label('sprites'))),
    named('recombine', createCheckedShaderModule(device, dofRecombineShader(), label('recombine'))),
  ])
  return Object.fromEntries(compiled) as Record<(typeof compiled)[number][0], GPUShaderModule>
}

/** Each compute pass's layout and entry point. */
const ENTRIES = {
  setupHalf: ['setup', 'setupHalf'],
  setupFull: ['setup', 'setupFull'],
  temporal: ['temporal', 'temporalSetup'],
  flatten: ['flatten', 'flattenCoc'],
  dilate: ['dilate', 'dilateCoc'],
  downsample: ['downsample', 'downsampleCoc'],
  reduce: ['reduce', 'reduceLevels'],
  pack: ['pack', 'packScatter'],
  lut: ['lut', 'buildLut'],
  gather: ['gather', 'gatherLayer'],
  postfilter: ['postfilter', 'postfilterLayer'],
  recombine: ['recombine', 'recombine'],
} as const
type Pass = keyof typeof ENTRIES

type Layouts = ReturnType<typeof dofLayouts>
type Modules = Awaited<ReturnType<typeof dofModules>>

/** The compute pipelines, each made once for its pass and constants. */
function computePipelines(device: GPUDevice, layouts: Layouts, modules: Modules) {
  const pipelines = preparedPipelines<
    { pass: Pass; constants: Constants },
    ReturnType<typeof preparedComputeStage>
  >(
    ({ pass, constants }) => {
      const [layout, entry] = ENTRIES[pass]
      return preparedComputeStage(
        device,
        // The recombine composes the translucency of the image, the second group.
        device.createPipelineLayout({
          bindGroupLayouts:
            pass === 'recombine' ? [layouts[layout], layersLayout(device)] : [layouts[layout]],
        }),
        modules[pass],
        entry,
        constants,
        `${DEPTH_OF_FIELD_PASS} ${pass}`,
      )
    },
    ({ pass, constants }) => `${pass}:${JSON.stringify(constants)}`,
  )
  return (pass: Pass, constants: Constants = {}) => pipelines.of({ pass, constants })
}

/** The sprites' render pipelines, each made once for its constants. */
function spritePipelines(device: GPUDevice, layouts: Layouts, modules: Modules) {
  const pipelines = preparedPipelines<Constants, ReturnType<typeof preparedPipeline>>(
    (constants) =>
      preparedPipeline(device, {
        label: `${DEPTH_OF_FIELD_PASS} sprites`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [layouts.sprites] }),
        vertex: { module: modules.sprites, entryPoint: 'scatterVertex', constants },
        fragment: {
          module: modules.sprites,
          entryPoint: 'scatterFragment',
          constants,
          targets: [{ format: COLOR_FORMAT, blend: ADDITIVE }],
        },
        primitive: { topology: 'triangle-list' },
      }),
    (constants) => JSON.stringify(constants),
  )
  return (constants: Constants) => pipelines.of(constants)
}

/**
 * The depth of field's programs, once a device: the shader modules, compiled and checked together, the
 * layouts, the samplers, and the pipelines each made once for what decides it — `compute(pass,
 * constants)` — and `sprites(constants)` for the draw of the scattered sprites; every pipeline is
 * prepared off the frame on first ask (`PreparedPipeline`), the frame waiting for it.
 */
export async function createDofPrograms(device: GPUDevice) {
  const layouts = dofLayouts(device)
  const modules = await dofModules(device)
  return {
    layouts,
    samplers: postSamplers(device),
    compute: computePipelines(device, layouts, modules),
    sprites: spritePipelines(device, layouts, modules),
  }
}

/** The programs (`createDofPrograms`). */
export type DofPrograms = Awaited<ReturnType<typeof createDofPrograms>>

/** The pipeline constants of a dilation's kind and radius. */
export const dilateConstants = (mode: keyof typeof DILATE_MODES, radius: number): Constants => ({
  MODE: DILATE_MODES[mode],
  RADIUS: radius,
})
