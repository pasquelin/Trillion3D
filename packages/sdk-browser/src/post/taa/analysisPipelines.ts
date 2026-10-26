import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import {
  TAA_DECIMATE_HISTORY_PASS,
  TAA_DETECT_THIN_GEOMETRY_PASS,
  TAA_RELAX_THIN_GEOMETRY_PASS,
  TAA_DILATE_VELOCITY_PASS,
  TAA_REJECT_SHADING_PASS,
  TAA_SPATIAL_ANTI_ALIASING_PASS,
} from '../../diagnostic/stage/passLabels.ts'
import { buildComputeStage, preparedComputeStage } from '../../gpu/core/computeStages.ts'
import type { AnalysisLayouts } from './analysisLayouts.ts'
import { NO_WPO, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { TEXEL_TILE } from './velocityWgsl.ts'
import { FLATTEN_TILE, type BlurVariant } from '../effects/motionBlur/motionBlurLayout.ts'
import { velocityShader } from './nearestVelocityWgsl.ts'
import { reprojectShader } from './reprojectWgsl.ts'
import {
  THIN_GEOMETRY_PLAN,
  THIN_RELAXATION_TILE,
  thinGeometryShader,
  thinRelaxationShader,
} from './thinGeometryWgsl.ts'
import { measureFlickerLumaShader, measureThinCoverageShader } from './flickerLumaWgsl.ts'
import { rejectShadingShader } from './rejectionWgsl.ts'
import {
  REJECT_SHADING_STRIDE,
  REJECT_SHADING_TILE,
  rejectionWaveOf,
} from './rejectionNetworkWgsl.ts'
import { SPATIAL_AA_TILE, spatialAntiAliasingShader } from './spatialAntiAliasingWgsl.ts'
import type { AnalysisFormats } from './analysisTargets.ts'
import type { PreparedPipeline } from '../../lighting/deferred/fullscreen.ts'
import { taaExecutionOf, type TaaExecution } from './waveOps.ts'

/** A compute stage prepared off the frame (`preparedComputeStage`). */
type PreparedStage = ReturnType<typeof preparedComputeStage>

/** Compiles one program of the analysis on `layout`, its entry point `entryPoint`, its overrides
 *  `constants`. */
type Stage = (
  layout: GPUBindGroupLayout,
  module: Promise<GPUShaderModule>,
  entryPoint: string,
  constants?: Record<string, number>,
) => ReturnType<typeof buildComputeStage>

/** The texels a workgroup of the nearest velocity covers across and down: a tile of the motion blur's
 *  where it flattens the blur's motion too. */
export const FUSED_TILE = FLATTEN_TILE

/** The dispatches of the analysis, in the order of their compute passes, each timed under its
 *  `pass`, its descriptor and label: its place `index` among the groups, the render texels a workgroup writes across and
 *  down (`tile`) — the nearest velocity and the reprojection, a texel a lane, the thin geometry
 *  detection, a tile, the shading rejection, the inner square of its tile, and the spatial
 *  anti-aliaser, a texel a lane —; the thin geometry's weight relaxation runs after the detection. */
export const DISPATCHES = [
  {
    name: 'nearest',
    index: 0,
    pass: { label: TAA_DILATE_VELOCITY_PASS },
    tile: [TEXEL_TILE, TEXEL_TILE],
  },
  {
    name: 'reproject',
    index: 1,
    pass: { label: TAA_DECIMATE_HISTORY_PASS },
    tile: [TEXEL_TILE, TEXEL_TILE],
  },
  {
    name: 'thin',
    index: 2,
    pass: { label: TAA_DETECT_THIN_GEOMETRY_PASS },
    tile: [THIN_GEOMETRY_PLAN.width, THIN_GEOMETRY_PLAN.height],
  },
  {
    name: 'relaxation',
    index: 5,
    pass: { label: TAA_RELAX_THIN_GEOMETRY_PASS },
    tile: [THIN_RELAXATION_TILE, THIN_RELAXATION_TILE],
  },
  {
    name: 'reject',
    index: 3,
    pass: { label: TAA_REJECT_SHADING_PASS },
    tile: [REJECT_SHADING_STRIDE, REJECT_SHADING_STRIDE],
  },
  {
    name: 'antiAlias',
    index: 4,
    pass: { label: TAA_SPATIAL_ANTI_ALIASING_PASS },
    tile: [SPATIAL_AA_TILE, SPATIAL_AA_TILE],
  },
] as const

/** The stage `entryPoint` of `module` on the one group `layout`, its overrides `constants`, prepared
 *  off the frame under `label`. */
const preparedOn = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entryPoint: string,
  constants: Record<string, number> | undefined,
  label: string,
) =>
  preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    module,
    entryPoint,
    constants,
    label,
  )

const built = (pipeline: GPUComputePipeline): Built => {
  const made: Built = {
    prepare: () => Promise.resolve(),
    ask: () => made,
    ready: true,
    get: () => pipeline,
  }
  return made
}

/** Compiles the program of a module checked off the thread, once it is: each text is compiled at
 *  its call, so the call names what it compiles. */
const stageOf =
  (device: GPUDevice): Stage =>
  async (layout, module, entryPoint, constants) => {
    const compiled = await module
    return buildComputeStage(device, [layout], compiled, entryPoint, constants, compiled.label)
  }

/** The modules the twin stages are made from, checked off the thread. */
type TwinModules = Record<'velocity' | 'reproject' | 'reject', Promise<GPUShaderModule>> & {
  /** The shading rejection in 16 bits, where the device grants them and the driver takes it. */
  rejectHalf?: Promise<GPUShaderModule>
  /** The shading rejection as a subgroup of the tile's width, in 32 and in 16 bits, where the device
   *  runs one (`rejectionWaveOf`) and the driver takes it. */
  rejectWave?: Promise<GPUShaderModule>
  rejectWaveHalf?: Promise<GPUShaderModule>
}

/** The programs of the analysis's dispatches, compiled together, with the 16-bit twins (`half`: the
 *  device grants 16-bit shader floats): one a driver refuses is left out, the 32-bit one the others'. */
async function compileDispatches(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  { antiAlias: antiAliasFormat, measure, mask, luma }: AnalysisFormats,
  modules: TwinModules,
  half: boolean,
) {
  const stage = stageOf(device)
  const optionalStage = (
    layout: GPUBindGroupLayout,
    module: Promise<GPUShaderModule> | undefined,
    entryPoint: string,
  ) => module && stage(layout, module, entryPoint).catch(() => undefined)
  const [
    velocity,
    reproject,
    thin,
    reject,
    rejectHalf,
    rejectWave,
    rejectWaveHalf,
    antiAlias,
    antiAliasHalf,
    relaxation,
  ] = await Promise.all([
    stage(layouts.velocity, modules.velocity, 'nearestVelocity'),
    stage(layouts.reproject, modules.reproject, 'reprojectHistories'),
    stage(
      layouts.thin,
      createCheckedShaderModule(device, thinGeometryShader(), 'TAA_THIN_GEOMETRY'),
      'detectThinGeometry',
    ),
    stage(layouts.rejectShading, modules.reject, 'rejectShading'),
    // The shading rejection in 16 bits, as the anti-aliaser below: run by an execution that asks it.
    optionalStage(layouts.rejectShading, modules.rejectHalf, 'rejectShading'),
    // And as a subgroup of the tile's width, in 32 and 16 bits: run by an execution whose wave it is.
    optionalStage(layouts.rejectShading, modules.rejectWave, 'rejectShading'),
    optionalStage(layouts.rejectShading, modules.rejectWaveHalf, 'rejectShading'),
    stage(
      layouts.antiAlias,
      createCheckedShaderModule(
        device,
        spatialAntiAliasingShader(antiAliasFormat, false, mask, luma),
        'TAA_SPATIAL_AA',
      ),
      'spatialAntiAliasing',
    ),
    // The anti-aliaser in 16 bits: run by an execution that asks it (`TaaExecution.half`).
    optionalStage(
      layouts.antiAlias,
      half
        ? createCheckedShaderModule(
            device,
            spatialAntiAliasingShader(antiAliasFormat, true, mask, luma),
            'TAA_SPATIAL_AA_F16',
          )
        : undefined,
      'spatialAntiAliasing',
    ),
    stage(
      layouts.relaxation,
      createCheckedShaderModule(device, thinRelaxationShader(measure), 'TAA_THIN_RELAXATION'),
      'relaxThinGeometryWeight',
    ),
  ])
  return {
    velocity,
    reproject,
    thin,
    reject,
    rejectHalf,
    rejectWave,
    rejectWaveHalf,
    antiAlias,
    antiAliasHalf,
    relaxation,
  }
}

/** The measures taken before the translucency (`TaaAnalysis.measure`), compiled together. */
function compileMeasures(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  { measure }: AnalysisFormats,
) {
  const stage = stageOf(device)
  return Promise.all([
    stage(
      layouts.measure.luma,
      createCheckedShaderModule(device, measureFlickerLumaShader(measure), 'TAA_MEASURE_LUMA'),
      'measureFlickeringLuma',
    ),
    stage(
      layouts.measure.coverage,
      createCheckedShaderModule(device, measureThinCoverageShader(measure), 'TAA_MEASURE_COVERAGE'),
      'measureThinGeometryCoverage',
    ),
  ])
}

/**
 * The stages made at the first ask only, off the modules of the dispatches: the nearest velocity a
 * scene that draws displaced surfaces runs (`DISPLACED`, `deformWgsl.ts`), and the reprojection and
 * the shading rejection of a history that resurrects (`RESURRECTION`).
 */
async function twinStages(device: GPUDevice, layouts: AnalysisLayouts, modules: TwinModules) {
  const displaced = preparedOn(
    device,
    layouts.velocity,
    await modules.velocity,
    'nearestVelocity',
    { DISPLACED: 1 },
    'TAA_VELOCITY',
  )
  const resurrecting = (layout: GPUBindGroupLayout, module: GPUShaderModule, entryPoint: string) =>
    preparedOn(device, layout, module, entryPoint, { RESURRECTION: 1 }, module.label)
  const rejecting = async (module: Promise<GPUShaderModule> | undefined) => {
    const made = await module?.catch(() => undefined)
    return made && resurrecting(layouts.rejectShading, made, 'rejectShading')
  }
  const resurrected = {
    reproject: resurrecting(layouts.reproject, await modules.reproject, 'reprojectHistories'),
    reject: resurrecting(layouts.rejectShading, await modules.reject, 'rejectShading'),
    rejectHalf: await rejecting(modules.rejectHalf),
    rejectWave: await rejecting(modules.rejectWave),
    rejectWaveHalf: await rejecting(modules.rejectWaveHalf),
  }
  return { displaced, resurrected }
}

/** The nearest velocity that also flattens the motion of a blur of a variant: its own module, made
 *  at the first ask, with its displaced twin, off the frame. */
function fusedStagesOf(device: GPUDevice, layouts: AnalysisLayouts, wpo: WpoSet) {
  const fused = new Map<string, { flat: PreparedStage; displaced: PreparedStage }>()
  return (variant: BlurVariant) => {
    const key = `${variant.directions} ${variant.flat}`
    let held = fused.get(key)
    if (!held) {
      const module = device.createShaderModule({
        label: `TAA_VELOCITY ${key}`,
        code: velocityShader(wpo, variant),
      })
      const layout = layouts.fusedVelocity(variant)
      const stage = (constants?: Record<string, number>) =>
        preparedOn(device, layout, module, 'nearestVelocity', constants, 'TAA_VELOCITY')
      fused.set(key, (held = { flat: stage(), displaced: stage({ DISPLACED: 1 }) }))
    }
    return held
  }
}

/** The compute programs of the analysis, compiled together off the thread. */
async function computePipelines(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  wpo: WpoSet,
  formats: AnalysisFormats,
) {
  const { guide, color, mask, luma } = formats
  const half = device.features.has('shader-f16')
  // The wave the shading rejection runs as is the subgroup of the tile's width, the history update's
  // choice of it (`taaExecutionOf`, `waveOps.ts`): the one a device that runs it has.
  const wave = rejectionWaveOf(taaExecutionOf(device, true, REJECT_SHADING_TILE, false).wave)
  const waveLabel = wave && ` wave ${wave.lanes}${wave.pinned ? ' pinned' : ''}`
  const modules: TwinModules = {
    velocity: createCheckedShaderModule(device, velocityShader(wpo), 'TAA_VELOCITY'),
    reproject: createCheckedShaderModule(device, reprojectShader(guide), 'TAA_REPROJECT'),
    reject: createCheckedShaderModule(
      device,
      rejectShadingShader(guide, color, false, mask, luma),
      'TAA_REJECT_SHADING',
    ),
    rejectHalf: half
      ? createCheckedShaderModule(
          device,
          rejectShadingShader(guide, color, true, mask, luma),
          'TAA_REJECT_SHADING_F16',
        )
      : undefined,
    rejectWave: wave
      ? createCheckedShaderModule(
          device,
          rejectShadingShader(guide, color, false, mask, luma, wave),
          `TAA_REJECT_SHADING${waveLabel}`,
        )
      : undefined,
    rejectWaveHalf:
      wave && half
        ? createCheckedShaderModule(
            device,
            rejectShadingShader(guide, color, true, mask, luma, wave),
            `TAA_REJECT_SHADING_F16${waveLabel}`,
          )
        : undefined,
  }
  const [
    {
      velocity,
      reproject,
      thin,
      reject,
      rejectHalf,
      rejectWave,
      rejectWaveHalf,
      antiAlias,
      antiAliasHalf,
      relaxation,
    },
    [measureLuma, measureCoverage],
  ] = await Promise.all([
    compileDispatches(device, layouts, formats, modules, half),
    compileMeasures(device, layouts, formats),
  ])
  const { displaced, resurrected } = await twinStages(device, layouts, modules)
  return {
    pipelines: {
      nearest: built(velocity),
      reproject: built(reproject),
      thin: built(thin),
      reject: built(reject),
      antiAlias: built(antiAlias),
      relaxation: built(relaxation),
    },
    measures: { luma: built(measureLuma), coverage: built(measureCoverage) },
    resurrected,
    antiAliasHalf: antiAliasHalf && built(antiAliasHalf),
    rejectHalf: rejectHalf && built(rejectHalf),
    rejectWave: rejectWave && built(rejectWave),
    rejectWaveHalf: rejectWaveHalf && built(rejectWaveHalf),
    displaced,
    /** The nearest velocity's stages that also flatten the motion of a blur of `variant`, made at
     *  the first ask. */
    fused: fusedStagesOf(device, layouts, wpo),
    /** Asks the programs of a history that resurrects, compiled off the thread. */
    askResurrection: () => {
      resurrected.reproject.ask()
      resurrected.reject.ask()
      resurrected.rejectHalf?.ask()
      resurrected.rejectWave?.ask()
      resurrected.rejectWaveHalf?.ask()
    },
  }
}

/** A pipeline of the analysis, ready or prepared off the frame. */
type Built = PreparedPipeline<GPUComputePipeline>

/** A dispatch's pipelines by the program an execution runs it as (`variantOf`). */
type Variants = readonly [Built, Built, Built, Built]

/** A dispatch's pipelines: by whether the history resurrects, then by variant. */
type DispatchStages = readonly [Variants, Variants]

/** The variant of a dispatch `run` executes: its 16-bit program (`TaaExecution.half`) and, past
 *  them, the one run as a subgroup of the tile's width (`rejectionWaveOf`), the shading
 *  rejection's alone. */
export const variantOf = ({ half, wave }: TaaExecution) =>
  Number(half) + 2 * Number(!!rejectionWaveOf(wave))

/** The pipelines of a dispatch by variant: where a program is left out (a device that does not
 *  run it, a driver that refuses it) the one that does what it does with less. */
const variants = (plain: Built, half = plain, wave = plain, waveHalf = half): Variants => [
  plain,
  half,
  wave,
  waveHalf,
]

/** The pipeline of each dispatch of `DISPATCHES`, in their order, as `DispatchStages` orders them. */
function dispatchStages({
  pipelines,
  resurrected,
  antiAliasHalf,
  rejectHalf,
  rejectWave,
  rejectWaveHalf,
}: Awaited<ReturnType<typeof computePipelines>>): readonly DispatchStages[] {
  const by = (plain: Variants, resurrecting = plain): DispatchStages => [plain, resurrecting]
  const byName = {
    nearest: by(variants(pipelines.nearest)),
    reproject: by(variants(pipelines.reproject), variants(resurrected.reproject)),
    thin: by(variants(pipelines.thin)),
    reject: by(
      variants(pipelines.reject, rejectHalf, rejectWave, rejectWaveHalf),
      variants(
        resurrected.reject,
        resurrected.rejectHalf,
        resurrected.rejectWave,
        resurrected.rejectWaveHalf,
      ),
    ),
    antiAlias: by(variants(pipelines.antiAlias, antiAliasHalf)),
    relaxation: by(variants(pipelines.relaxation)),
  }
  return DISPATCHES.map(({ name }) => byName[name])
}

/**
 * The analysis's programs: its dispatches' compute pipelines (`stages`), in the order of their
 * `DISPATCHES`, each with the reprojection's and the shading rejection's of a history that
 * resurrects (asked only by one) and the 16-bit twins of the shading rejection (its resurrecting
 * one too) and the anti-aliaser where the device grants 16-bit shader floats; the nearest velocity's pipeline for an image that draws displaced surfaces
 * (`displaced`, asked only by one); the reprojection and the shading rejection store the shading
 * histories in `formats.guide`, the shading rejection the scene colour in `formats.color`; the
 * spatial anti-aliaser's, last, stores to a target of `formats.antiAlias`.
 */
export async function createAnalysisPipelines(
  device: GPUDevice,
  layouts: AnalysisLayouts,
  formats: AnalysisFormats,
  wpo: WpoSet = NO_WPO,
) {
  const compiled = await computePipelines(device, layouts, wpo, formats)
  const { measures, displaced, fused, askResurrection } = compiled
  return {
    stages: dispatchStages(compiled),
    /** The measures taken before the translucency, encoded apart (`TaaAnalysis.measure`). */
    measures,
    displaced,
    fused,
    askResurrection,
  }
}
