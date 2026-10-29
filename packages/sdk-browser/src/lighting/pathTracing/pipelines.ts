import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { dagReadLayoutEntries } from '../../geometry/dag/shader/bindings.ts'
import { skyLightReadLayoutEntries } from '../../modules/sky/skyLight/read.ts'
import { DEPTH_FORMAT, HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  fullscreenDescriptor,
  pipelineLayoutOf,
  preparedComputePipeline,
  preparedPipeline,
  type PreparedPipeline,
} from '../deferred/fullscreen.ts'
import { sceneHitCornersEntry } from '../rays/sceneTrace/sceneHitCornersWgsl.ts'
import { sceneTraceLayoutEntries } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import {
  PT_ACCUMULATE_BINDINGS,
  PT_ACCUMULATE_ENTRIES,
  PT_ACCUMULATE_WGSL,
} from './accumulateProgram.ts'
import { PT_ARGS_BINDINGS, PT_ARGS_ENTRY, PT_ARGS_WGSL } from './argsProgram.ts'
import { PT_ADAPTIVE_ERROR_ENTRY, PT_ADAPTIVE_ERROR_KERNEL_WGSL } from './adaptiveErrorWgsl.ts'
import {
  PT_GRID_BUILD_BINDINGS,
  PT_GRID_BUILD_WGSL,
  PT_SKY_BINDINGS,
  PT_SKY_BUILD_WGSL,
} from './buildPrograms.ts'
import { PT_DISPLAY_WGSL } from './displayWgsl.ts'
import { PT_LIGHT_GRID_ENTRY } from './lightGridWgsl.ts'
import { PT_NORMAL_SPACE_ENTRY, PT_NORMAL_SPACE_WGSL } from './normalSpaceWgsl.ts'
import { PT_SKY_COMPENSATE_ENTRY, PT_SKY_MIP_ENTRY, PT_SKY_PREPARE_ENTRY } from './skyWgsl.ts'
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
import { PT_VIEW } from './viewWgsl.ts'

/** The format of the accumulated radiance, and of the albedo and normal beside it: radiance accumulates in floats, so that smooth gradients do not band. */
export const PT_RADIANCE_FORMAT = 'rgba32float' as const
export const PT_AOV_FORMAT = 'rgba16float' as const
/** The depth of the camera's hits: a float, written to the frame's depth by the display. */
export const PT_DEPTH_FORMAT = 'r32float' as const
/** The error chain's format (the sum of a pixel's luminance and of its square, and its count): floats. */
export const PT_VARIANCE_FORMAT = 'rgba32float' as const
/** The sky's table: the radiance in floats, the density a float. */
export const PT_SKY_TEXTURE_FORMAT = 'rgba32float' as const
export const PT_SKY_PDF_FORMAT = 'r32float' as const
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
  readonly argsLayouts: readonly [GPUBindGroupLayout, GPUBindGroupLayout]
  readonly args: PreparedPipeline<GPUComputePipeline>
  readonly trace: Stages<keyof typeof PT_TRACE_ENTRIES>
  readonly accumulateLayout: GPUBindGroupLayout
  readonly accumulate: Stages<keyof typeof PT_ACCUMULATE_ENTRIES>
  readonly gridLayout: GPUBindGroupLayout
  readonly grid: PreparedPipeline<GPUComputePipeline>
  readonly skyLayouts: readonly [GPUBindGroupLayout, GPUBindGroupLayout]
  readonly sky: Stages<'prepare' | 'mip' | 'compensate'>
  readonly errorLayout: GPUBindGroupLayout
  readonly error: PreparedPipeline<GPUComputePipeline>
  readonly normalLayout: GPUBindGroupLayout
  readonly normal: PreparedPipeline<GPUComputePipeline>
  readonly displayLayout: GPUBindGroupLayout
  readonly display: PreparedPipeline<GPURenderPipeline>
  /** Every compute pipeline, to be waited for together. */
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

/** The trace of the bounces' rays and the finish of each bounce: the layouts of their two groups, the first the paths' and the sky's and lights', the second the scene trace's and the hits'. */
function traceStages(device: GPUDevice) {
  const B = PT_TRACE_BINDINGS
  const first = PT_TRACE_SCENE.first
  const paths = [
    computeUniformEntry(B.view, { hasDynamicOffset: true, minBindingSize: PT_VIEW.words * 4 }),
    ...dagReadLayoutEntries(),
    computeBufferEntry(B.states, 'storage'),
    computeBufferEntry(B.queue, 'storage'),
  ]
  const trace0 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer trace',
    entries: [...paths, computeTextureEntry(B.variance, 'unfilterable-float')],
  })
  const trace1 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer scene trace',
    entries: [
      ...sceneTraceLayoutEntries(first),
      sceneHitCornersEntry(first + PT_TRACE_STAGE_BINDINGS.corners),
      computeBufferEntry(first + PT_TRACE_STAGE_BINDINGS.placements, 'read-only-storage'),
      computeBufferEntry(first + PT_TRACE_STAGE_BINDINGS.hits, 'storage'),
    ],
  })
  const finish0 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer finish',
    entries: [
      ...paths,
      computeBufferEntry(B.lights, 'read-only-storage'),
      computeUniformEntry(B.gridParams),
      computeTextureEntry(B.grid, 'uint', '2d-array'),
      computeTextureEntry(B.gridData, 'uint'),
      computeTextureEntry(B.skyTexture, 'unfilterable-float'),
      computeTextureEntry(B.skyPdf, 'unfilterable-float'),
    ],
  })
  const finish1 = device.createBindGroupLayout({
    label: 'Trillion3D path tracer finish scene trace',
    entries: [
      ...sceneTraceLayoutEntries(first),
      computeBufferEntry(first + PT_FINISH_BINDINGS.hits, 'read-only-storage'),
      computeBufferEntry(first + PT_FINISH_BINDINGS.materials, 'read-only-storage'),
    ],
  })
  const traceModule = device.createShaderModule({
    label: 'Trillion3D path tracer trace',
    code: ptTraceProgram(),
  })
  const finishModule = device.createShaderModule({
    label: 'Trillion3D path tracer finish',
    code: ptFinishProgram(),
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

function skyStages(device: GPUDevice) {
  const sky = device.createBindGroupLayout({
    label: 'Trillion3D path tracer sky light',
    entries: skyLightReadLayoutEntries(PT_SKY_BINDINGS, COMPUTE),
  })
  const build = device.createBindGroupLayout({
    label: 'Trillion3D path tracer sky table',
    entries: [
      computeUniformEntry(0),
      computeStorageTextureEntry(1, PT_SKY_TEXTURE_FORMAT),
      computeStorageTextureEntry(2, PT_SKY_PDF_FORMAT, 'read-write'),
      computeTextureEntry(3, 'unfilterable-float'),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D path tracer sky table',
    code: PT_SKY_BUILD_WGSL,
  })
  return {
    layouts: [sky, build] as const,
    stages: {
      prepare: compute(device, module, [sky, build], PT_SKY_PREPARE_ENTRY),
      mip: compute(device, module, [sky, build], PT_SKY_MIP_ENTRY),
      compensate: compute(device, module, [sky, build], PT_SKY_COMPENSATE_ENTRY),
    },
  }
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

/** The path tracer's pipelines on `device`: made once, each prepared off the frame. */
export const pathTracingPipelinesOf = oncePerDevice((device: GPUDevice): PathTracingPipelines => {
  const trace = traceStages(device)
  const args = argsStage(device)
  const accumulate = accumulateStages(device)
  const grid = gridStage(device)
  const sky = skyStages(device)
  const error = errorStage(device)
  const normal = normalStage(device)
  const display = displayStage(device)
  return {
    traceLayouts: trace.traceLayouts,
    finishLayouts: trace.finishLayouts,
    finish: trace.finish,
    trace: trace.stages,
    argsLayouts: args.layouts,
    args: args.stage,
    accumulateLayout: accumulate.layout,
    accumulate: accumulate.stages,
    gridLayout: grid.layout,
    grid: grid.stage,
    skyLayouts: sky.layouts,
    sky: sky.stages,
    errorLayout: error.layout,
    error: error.stage,
    normalLayout: normal.layout,
    normal: normal.stage,
    displayLayout: display.layout,
    display: display.stage,
    all: [
      ...Object.values(trace.stages),
      trace.finish,
      args.stage,
      ...Object.values(accumulate.stages),
      grid.stage,
      ...Object.values(sky.stages),
      error.stage,
      normal.stage,
      display.stage,
    ],
  }
})
