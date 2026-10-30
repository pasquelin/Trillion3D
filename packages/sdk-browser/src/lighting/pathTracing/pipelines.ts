import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  fullscreenDescriptor,
  pipelineLayoutOf,
  preparedComputePipeline,
  preparedPipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { sceneMaskedLayoutEntries } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import {
  PT_ACCUMULATE_BINDINGS,
  PT_ACCUMULATE_ENTRIES,
  PT_ACCUMULATE_WGSL,
} from './accumulateProgram.ts'
import { PT_ARGS_BINDINGS, PT_ARGS_ENTRY, PT_ARGS_WGSL } from './argsProgram.ts'
import { PT_ADAPTIVE_ERROR_ENTRY, PT_ADAPTIVE_ERROR_KERNEL_WGSL } from './adaptiveErrorWgsl.ts'
import { PT_GRID_BUILD_BINDINGS, PT_GRID_BUILD_WGSL } from './buildPrograms.ts'
import { PT_DISPLAY_WGSL } from './displayWgsl.ts'
import { PT_LIGHT_GRID_ENTRY } from './lightGridWgsl.ts'
import { PT_NORMAL_SPACE_ENTRY, PT_NORMAL_SPACE_WGSL } from './normalSpaceWgsl.ts'
import { skyTableStagesOf } from '../skyTable/skyTableStages.ts'
import { PT_FINISH_BINDINGS } from './finishWgsl.ts'
import { PT_TRACE_STAGE_BINDINGS } from './traceBounceWgsl.ts'
import {
  PT_FINISH_ENTRY,
  PT_TRACE_BINDINGS,
  PT_TRACE_ENTRIES,
  PT_TRACE_SCENE,
  ptFinishProgram,
  ptTraceProgram,
} from './traceProgram.ts'
import { PT_AIR_BINDINGS, PT_AIR_DEPTH_FORMAT } from './airMediumWgsl.ts'
import { PT_AIR_DEPTH_BINDINGS, PT_AIR_DEPTH_ENTRY, PT_AIR_DEPTH_WGSL } from './airDepthWgsl.ts'
import { PT_CLOUD_MAP_BINDINGS, PT_CLOUD_MAP_ENTRY, PT_CLOUD_MAP_WGSL } from './cloudMapWgsl.ts'
import { PT_CLOUD_BINDINGS, PT_CLOUD_MAP_FORMAT } from './cloudMediumWgsl.ts'
import { PT_VISUALIZE_ENTRY } from './visualizeWgsl.ts'
import { isPayloadView } from './framePlan.ts'
import { PT_VIEW } from './viewWgsl.ts'
import { cloudMaterialLayoutEntries } from '../../modules/sky/clouds/materialWgsl.ts'

/** The format of the accumulated radiance, and of the albedo and normal beside it: radiance accumulates in floats, so that smooth gradients do not band. */
export const PT_RADIANCE_FORMAT = 'rgba32float' as const
export const PT_AOV_FORMAT = 'rgba16float' as const
/** The depth of the camera's hits: a float, written to the frame's depth by the display. */
export const PT_DEPTH_FORMAT = 'r32float' as const
/** The error chain's format (the sum of a pixel's luminance and of its square, and its count): floats. */
export const PT_VARIANCE_FORMAT = 'rgba32float' as const
/** The light grid's counts and lists. */
export const PT_GRID_FORMAT = 'r32uint' as const

/** The bytes of the display's uniform (`PtDisplayView`) and of the error chain's (`PtErrorLevels`) and the normals' (`PtNormalView`). */
export const PT_DISPLAY_VIEW_BYTES = 48
export const PT_ERROR_LEVELS_BYTES = 16
export const PT_NORMAL_VIEW_BYTES = 64

/** The compute pipelines of one program by entry, prepared off the frame. */
type Stages<Name extends string> = Readonly<Record<Name, PreparedPipeline<GPUComputePipeline>>>

/** Every pipeline of the path tracer, and the layouts of the groups they bind. */
export interface PathTracingPipelines {
  readonly traceLayouts: readonly [GPUBindGroupLayout, GPUBindGroupLayout]
  readonly finishLayouts: readonly [GPUBindGroupLayout, GPUBindGroupLayout]
  readonly finish: PreparedPipeline<GPUComputePipeline>
  /** The view of the payload that takes the finish's place (`pathTracingVisualize`); compiled only when a view is asked for, as is the finish only when none is (`finishStageOf`). */
  readonly visualize: PreparedPipeline<GPUComputePipeline>
  readonly argsLayouts: readonly [GPUBindGroupLayout, GPUBindGroupLayout]
  readonly args: PreparedPipeline<GPUComputePipeline>
  readonly trace: Stages<keyof typeof PT_TRACE_ENTRIES>
  readonly accumulateLayout: GPUBindGroupLayout
  readonly accumulate: Stages<keyof typeof PT_ACCUMULATE_ENTRIES>
  readonly gridLayout: GPUBindGroupLayout
  readonly grid: PreparedPipeline<GPUComputePipeline>
  readonly errorLayout: GPUBindGroupLayout
  readonly error: PreparedPipeline<GPUComputePipeline>
  readonly airDepthLayout: GPUBindGroupLayout
  readonly airDepth: PreparedPipeline<GPUComputePipeline>
  readonly cloudMapLayout: GPUBindGroupLayout
  readonly cloudMap: PreparedPipeline<GPUComputePipeline>
  readonly normalLayout: GPUBindGroupLayout
  readonly normal: PreparedPipeline<GPUComputePipeline>
  readonly displayLayout: GPUBindGroupLayout
  readonly display: PreparedPipeline<GPURenderPipeline>
  /** Every compute pipeline every image runs, to be waited for together (the table of the air and the map of the clouds are not among them: `volumeStagesOf`). */
  readonly all: readonly PreparedPipeline<unknown>[]
}

const compute = (
  device: GPUDevice,
  module: GPUShaderModule,
  layouts: readonly GPUBindGroupLayout[],
  entryPoint: string,
) =>
  preparedComputePipeline(device, {
    layout: pipelineLayoutOf(device, layouts),
    compute: { module, entryPoint },
  })

/** The bindings the clouds add to the first group of the trace and of the finish: the cloud material, the clouds' block and the acceleration map. */
const cloudLayoutEntries = () => [
  ...cloudMaterialLayoutEntries(PT_CLOUD_BINDINGS.material),
  computeUniformEntry(PT_CLOUD_BINDINGS.params),
  computeTextureEntry(PT_CLOUD_BINDINGS.map, 'unfilterable-float'),
]

/** The entries the trace and the finish share in their first group: the view, the DAG, the paths' states and queue, the air and, with `clouds`, the clouds. */
const pathsEntries = (clouds: boolean) => {
  const B = PT_TRACE_BINDINGS
  return [
    computeUniformEntry(B.view, { hasDynamicOffset: true, minBindingSize: PT_VIEW.words * 4 }),
    ...dagReadLayoutEntries(),
    computeBufferEntry(B.states, 'storage'),
    computeBufferEntry(B.queue, 'storage'),
    computeUniformEntry(PT_AIR_BINDINGS.atmosphere),
    computeTextureEntry(PT_AIR_BINDINGS.depth, 'unfilterable-float'),
    ...(clouds ? cloudLayoutEntries() : []),
  ]
}

/** The entries of the finish's two groups (the paths', sky's and lights'; the scene trace's and the hits'), with the clouds where `clouds`: the sampled textures they hold are what `PT_CLOUD_FINISH_TEXTURES` counts. */
export function finishLayoutEntries(clouds: boolean) {
  const B = PT_TRACE_BINDINGS
  const first = PT_TRACE_SCENE.first
  return [
    [
      ...pathsEntries(clouds),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeUniformEntry(B.gridParams),
      computeTextureEntry(B.grid, 'uint', '2d-array'),
      computeTextureEntry(B.gridData, 'uint'),
      computeTextureEntry(B.skyTexture, 'unfilterable-float'),
      computeTextureEntry(B.skyPdf, 'unfilterable-float'),
    ],
    [
      ...sceneMaskedLayoutEntries(first),
      computeBufferEntry(first + PT_FINISH_BINDINGS.hits, 'read-only-storage'),
      computeBufferEntry(first + PT_FINISH_BINDINGS.materials, 'read-only-storage'),
    ],
  ] as const
}

/** The trace of the bounces' rays and the finish of each bounce: the layouts of their two groups, the first the paths' and the sky's and lights', the second the scene trace's and the hits'; with `clouds`, the first group also binds the clouds. */
function traceStages(device: GPUDevice, programs: SceneMaskPrograms, clouds: boolean) {
  const B = PT_TRACE_BINDINGS
  const first = PT_TRACE_SCENE.first
  const paths = pathsEntries(clouds)
  const trace0 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer trace',
    entries: [...paths, computeTextureEntry(B.variance, 'unfilterable-float')],
  })
  const trace1 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer scene trace',
    entries: [
      ...sceneMaskedLayoutEntries(first),
      computeBufferEntry(first + PT_TRACE_STAGE_BINDINGS.placements, 'read-only-storage'),
      computeBufferEntry(first + PT_TRACE_STAGE_BINDINGS.hits, 'storage'),
    ],
  })
  const [finish0Entries, finish1Entries] = finishLayoutEntries(clouds)
  const finish0 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer finish',
    entries: finish0Entries,
  })
  const finish1 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer finish scene trace',
    entries: finish1Entries,
  })
  const traceModule = device.createShaderModule({
    label: `Trillion3D path tracer trace ${sceneMaskKey(programs)}`,
    code: ptTraceProgram(programs, clouds),
  })
  const finishModule = device.createShaderModule({
    label: `Trillion3D path tracer finish ${sceneMaskKey(programs)}`,
    code: ptFinishProgram(programs, clouds),
  })
  const trace = (entry: string) => compute(device, traceModule, [trace0, trace1], entry)
  return {
    traceLayouts: [trace0, trace1] as const,
    finishLayouts: [finish0, finish1] as const,
    stages: {
      cameraGrid: trace(PT_TRACE_ENTRIES.cameraGrid),
      cameraList: trace(PT_TRACE_ENTRIES.cameraList),
      inner: trace(PT_TRACE_ENTRIES.inner),
    },
    finish: compute(device, finishModule, [finish0, finish1], PT_FINISH_ENTRY),
    visualize: compute(device, finishModule, [finish0, finish1], PT_VISUALIZE_ENTRY),
  }
}

function argsStage(device: GPUDevice) {
  const view = device.createBindGroupLayout({
    label: 'Trillion3D path tracer dispatch arguments',
    entries: [
      computeUniformEntry(PT_ARGS_BINDINGS.view, {
        hasDynamicOffset: true,
        minBindingSize: PT_VIEW.words * 4,
      }),
      computeBufferEntry(PT_ARGS_BINDINGS.queue, 'storage'),
    ],
  })
  const out = device.createBindGroupLayout({
    label: 'Trillion3D path tracer dispatch arguments written',
    entries: [computeBufferEntry(PT_ARGS_BINDINGS.out, 'storage')],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer dispatch arguments',
    code: PT_ARGS_WGSL,
  })
  return {
    layouts: [view, out] as const,
    stage: compute(device, module, [view, out], PT_ARGS_ENTRY),
  }
}

function accumulateStages(device: GPUDevice) {
  const B = PT_ACCUMULATE_BINDINGS
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer accumulation',
    entries: [
      computeUniformEntry(B.view, { hasDynamicOffset: true, minBindingSize: PT_VIEW.words * 4 }),
      computeBufferEntry(B.states, 'storage'),
      computeBufferEntry(B.queue, 'storage'),
      computeTextureEntry(B.radianceIn, 'unfilterable-float'),
      computeTextureEntry(B.albedoIn, 'unfilterable-float'),
      computeTextureEntry(B.normalIn, 'unfilterable-float'),
      computeStorageTextureEntry(B.radianceOut, PT_RADIANCE_FORMAT),
      computeStorageTextureEntry(B.albedoOut, PT_AOV_FORMAT),
      computeStorageTextureEntry(B.normalOut, PT_AOV_FORMAT),
      computeTextureEntry(B.varianceIn, 'unfilterable-float'),
      computeStorageTextureEntry(B.varianceOut, PT_VARIANCE_FORMAT),
      computeUniformEntry(B.varianceDims),
      computeTextureEntry(B.depthIn, 'unfilterable-float'),
      computeStorageTextureEntry(B.depthOut, PT_DEPTH_FORMAT),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer accumulation',
    code: PT_ACCUMULATE_WGSL,
  })
  return {
    layout,
    stages: {
      resolve: compute(device, module, [layout], PT_ACCUMULATE_ENTRIES.resolve),
      variance: compute(device, module, [layout], PT_ACCUMULATE_ENTRIES.variance),
      adaptiveStart: compute(device, module, [layout], PT_ACCUMULATE_ENTRIES.adaptiveStart),
    },
  }
}

function gridStage(device: GPUDevice) {
  const B = PT_GRID_BUILD_BINDINGS
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer light grid',
    entries: [
      computeUniformEntry(B.params),
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeStorageTextureEntry(B.grid, PT_GRID_FORMAT, 'write-only', '2d-array'),
      computeStorageTextureEntry(B.gridData, PT_GRID_FORMAT),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer light grid',
    code: PT_GRID_BUILD_WGSL,
  })
  return { layout, stage: compute(device, module, [layout], PT_LIGHT_GRID_ENTRY) }
}

function errorStage(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer error chain',
    entries: [
      computeUniformEntry(0),
      computeTextureEntry(1, 'unfilterable-float'),
      computeStorageTextureEntry(2, PT_VARIANCE_FORMAT),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer error chain',
    code: wgslModule(PT_ADAPTIVE_ERROR_KERNEL_WGSL),
  })
  return { layout, stage: compute(device, module, [layout], PT_ADAPTIVE_ERROR_ENTRY) }
}

function airDepthStage(device: GPUDevice) {
  const B = PT_AIR_DEPTH_BINDINGS
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer air optical depth',
    entries: [
      computeUniformEntry(B.atmosphere),
      computeStorageTextureEntry(B.table, PT_AIR_DEPTH_FORMAT),
      computeUniformEntry(B.params, { hasDynamicOffset: true }),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer air optical depth',
    code: PT_AIR_DEPTH_WGSL,
  })
  return { layout, stage: compute(device, module, [layout], PT_AIR_DEPTH_ENTRY) }
}

function cloudMapStage(device: GPUDevice) {
  const B = PT_CLOUD_MAP_BINDINGS
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer cloud acceleration map',
    entries: [
      computeUniformEntry(B.params),
      computeTextureEntry(B.previous, 'unfilterable-float'),
      computeStorageTextureEntry(B.map, PT_CLOUD_MAP_FORMAT),
      ...cloudMaterialLayoutEntries(B.material),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer cloud acceleration map',
    code: PT_CLOUD_MAP_WGSL,
  })
  return { layout, stage: compute(device, module, [layout], PT_CLOUD_MAP_ENTRY) }
}

function normalStage(device: GPUDevice) {
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer normal space',
    entries: [
      computeUniformEntry(0),
      computeTextureEntry(1, 'unfilterable-float'),
      computeStorageTextureEntry(2, PT_AOV_FORMAT),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer normal space',
    code: wgslModule(PT_NORMAL_SPACE_WGSL),
  })
  return { layout, stage: compute(device, module, [layout], PT_NORMAL_SPACE_ENTRY) }
}

function displayStage(device: GPUDevice) {
  const FRAGMENT = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: 'Trillion3D path tracer display',
    entries: [
      computeUniformEntry(0, {}, FRAGMENT),
      computeTextureEntry(1, 'unfilterable-float', '2d', FRAGMENT),
      computeTextureEntry(2, 'unfilterable-float', '2d', FRAGMENT),
      computeUniformEntry(3, {}, FRAGMENT),
      computeTextureEntry(4, 'unfilterable-float', '2d', FRAGMENT),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer display',
    code: wgslModule(PT_DISPLAY_WGSL),
  })
  return {
    layout,
    stage: preparedPipeline(device, {
      ...fullscreenDescriptor(device, module, layout, 'ptDisplay', [{ format: HDR_FORMAT }]),
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'always' },
    }),
  }
}

/** The stages that cast no ray, made once for the device whatever the graph masks the rays cut by. */
const commonStagesOf = oncePerDevice((device: GPUDevice) => ({
  args: argsStage(device),
  accumulate: accumulateStages(device),
  grid: gridStage(device),
  error: errorStage(device),
  airDepth: airDepthStage(device),
  cloudMap: cloudMapStage(device),
  normal: normalStage(device),
  display: displayStage(device),
}))

/** Every pipeline of the path tracer from the trace and finish stages `trace` (`traceStages`) and the stages that cast no ray. */
function pipelinesOf(
  device: GPUDevice,
  trace: ReturnType<typeof traceStages>,
): PathTracingPipelines {
  const { args, accumulate, grid, error, airDepth, cloudMap, normal, display } =
    commonStagesOf(device)
  const sky = skyTableStagesOf(device)
  return {
    traceLayouts: trace.traceLayouts,
    finishLayouts: trace.finishLayouts,
    finish: trace.finish,
    visualize: trace.visualize,
    trace: trace.stages,
    argsLayouts: args.layouts,
    args: args.stage,
    accumulateLayout: accumulate.layout,
    accumulate: accumulate.stages,
    gridLayout: grid.layout,
    grid: grid.stage,
    errorLayout: error.layout,
    error: error.stage,
    airDepthLayout: airDepth.layout,
    airDepth: airDepth.stage,
    cloudMapLayout: cloudMap.layout,
    cloudMap: cloudMap.stage,
    normalLayout: normal.layout,
    normal: normal.stage,
    displayLayout: display.layout,
    display: display.stage,
    all: [
      ...Object.values(trace.stages),
      args.stage,
      ...Object.values(accumulate.stages),
      grid.stage,
      ...Object.values(sky.stages),
      error.stage,
      normal.stage,
      display.stage,
    ],
  }
}

/**
 * The path tracer's pipelines on `device`, each prepared off the frame: the stages that cast rays are made once for each set of graph masks `programs` the rays
 * cut the surfaces by (the programs `maskHold.use` returns), the others once. With the key `clouds` the pipelines of the path tracer where the clouds are traced: the trace and the finish made over the clouds'
 * bindings and code (`traceStages` with `clouds`), the rest those of `plain`. Made the first time the clouds are traced on a device and a set of graph masks; the cloudless trace and finish are not compiled for it.
 */
export const pathTracingPipelinesOver = oncePerDeviceOverPrograms(
  (device: GPUDevice, key: 'plain' | 'clouds', programs): PathTracingPipelines =>
    pipelinesOf(device, traceStages(device, programs, key === 'clouds')),
)

/** The maker of the pipelines for a device and a key, as the mask hold takes it (`maskHold.use`): one function each, not one an image. */
export const pathTracingMaker = heldMakerOf(pathTracingPipelinesOver)

/** The stage that ends each bounce: the view of the payload where one is asked for (`isPayloadView`), the finish otherwise. The other is never asked, so never compiled. */
export const finishStageOf = (pipelines: PathTracingPipelines, visualize: string) =>
  isPayloadView(visualize) ? pipelines.visualize : pipelines.finish

/** The stages of the volumes an image runs: the table of the air's optical depth where the air is traced, the clouds' acceleration map where the clouds are. */
export const volumeStagesOf = (pipelines: PathTracingPipelines, air: boolean, clouds: boolean) => [
  ...(air ? [pipelines.airDepth] : []),
  ...(clouds ? [pipelines.cloudMap] : []),
]
