import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../gpu/core/computeBindings.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { groupWidth, groupWidthConstants } from '../../../gpu/dispatch/grid.ts'
import { buildRenderPipeline } from '../../../lighting/deferred/fullscreen.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { classifyShader, CLASSIFY_BINDINGS } from './classifyWgsl.ts'
import { gatherShader, GATHER_BINDINGS, scatterShader, SCATTER_BINDINGS } from './dilateWgsl.ts'
import { FILTER_BINDINGS, filterShader } from './filterWgsl.ts'
import { FLATTEN_BINDINGS, flattenShader } from './flattenWgsl.ts'
import {
  FILTER_TILE,
  FLAT_FORMAT,
  OUTPUT_FORMAT,
  TILE_CLASSES,
  TILE_DEPTH_FORMAT,
  TILE_FORMAT,
  WRITE_ALL,
  WRITE_LARGEST,
  isHalfClass,
  type TileClass,
} from './motionBlurLayout.ts'

/** The pipeline constants of each class's filter (`filterShader`): the workgroup's side, and whether
 *  its tiles are gathered at half the resolution and weighed. */
const classConstants = (kind: TileClass) => ({
  TILE: isHalfClass(kind) ? FILTER_TILE / 2 : FILTER_TILE,
  HALF_RES: isHalfClass(kind) ? 1 : 0,
  WEIGH: kind.startsWith('weigh') ? 1 : 0,
})

/** The layout entries of the flattening of one direction, which the flattening of two adds to. */
export const flattenEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FLATTEN_BINDINGS.params),
  computeUniformEntry(FLATTEN_BINDINGS.view),
  computeTextureEntry(FLATTEN_BINDINGS.vectors, 'uint'),
  computeTextureEntry(FLATTEN_BINDINGS.depth, 'depth'),
  computeStorageTextureEntry(FLATTEN_BINDINGS.flat, FLAT_FORMAT),
  computeStorageTextureEntry(FLATTEN_BINDINGS.tiles, TILE_FORMAT),
]

/** The layout entries of the filter of a class of one motion, which the class of two adds to. */
export const filterEntries = (): GPUBindGroupLayoutEntry[] => [
  computeUniformEntry(FILTER_BINDINGS.params),
  computeTextureEntry(FILTER_BINDINGS.color, 'float'),
  computeSamplerEntry(FILTER_BINDINGS.sampler, 'filtering'),
  computeTextureEntry(FILTER_BINDINGS.flat, 'uint'),
  computeTextureEntry(FILTER_BINDINGS.tiles, 'unfilterable-float'),
  computeBufferEntry(FILTER_BINDINGS.list, 'read-only-storage', GPUShaderStage.COMPUTE),
  computeStorageTextureEntry(FILTER_BINDINGS.blurred, OUTPUT_FORMAT),
]

/** The bind group layout of each pass of the blur. */
function motionBlurLayouts(device: GPUDevice) {
  const compute = GPUShaderStage.COMPUTE,
    vertex = GPUShaderStage.VERTEX
  const layout = (label: string, entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: `${MOTION_BLUR_PASS} ${label}`, entries })
  return {
    flatten: layout('flatten', flattenEntries()),
    gather: layout('gather', [
      computeUniformEntry(GATHER_BINDINGS.params),
      computeTextureEntry(GATHER_BINDINGS.tiles, 'unfilterable-float'),
      computeStorageTextureEntry(GATHER_BINDINGS.out, TILE_FORMAT),
    ]),
    scatter: layout('scatter', [
      computeUniformEntry(SCATTER_BINDINGS.params, {}, vertex),
      computeTextureEntry(SCATTER_BINDINGS.tiles, 'unfilterable-float', '2d', vertex),
    ]),
    classify: layout('classify', [
      computeUniformEntry(CLASSIFY_BINDINGS.params),
      computeTextureEntry(CLASSIFY_BINDINGS.tiles, 'unfilterable-float'),
      ...TILE_CLASSES.map((kind) =>
        computeBufferEntry(CLASSIFY_BINDINGS[kind], 'storage', compute),
      ),
    ]),
    filter: layout('filter', filterEntries()),
  }
}

/** The compute stage `entryPoint` of the blur's module `made` on `layout`, its overrides
 *  `constants`. */
export async function blurStage(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  made: Promise<GPUShaderModule>,
  entryPoint: string,
  constants?: Record<string, number>,
) {
  return buildComputeStage(device, [layout], await made, entryPoint, constants, MOTION_BLUR_PASS)
}

/** The compute pipelines one blur's passes run: the flattening, the gathered spread, the
 *  classifying and the filter of each class of tile, in the order of its classes. */
export type Kit = {
  flatten: GPUComputePipeline
  gather: GPUComputePipeline
  classify: GPUComputePipeline
  filters: readonly GPUComputePipeline[]
}

/** A draw of the spread, its depth test and the channels it writes: the shorter smallest motion
 *  or, `largest`, the longer largest. */
async function scatterDraw(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  made: Promise<GPUShaderModule>,
  largest: boolean,
) {
  const module = await made
  return buildRenderPipeline(device, {
    label: `${MOTION_BLUR_PASS} scatter`,
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: { module, entryPoint: 'scatterVertex', constants: { SCATTER_MAX: largest ? 1 : 0 } },
    fragment: {
      module,
      entryPoint: 'scatterFragment',
      targets: [{ format: TILE_FORMAT, writeMask: largest ? WRITE_LARGEST : WRITE_ALL }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: TILE_DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: largest ? 'greater' : 'less',
    },
  })
}

/**
 * The motion blur's programs, once a device, compiled together off the thread: the layouts of each
 * pass, the pipelines of the flattening, the gathered spread, the classifying, the filter of each
 * class of tile (`TILE_CLASSES`), and the two draws of the drawn
 * spread — the first keeping the shorter smallest motion, the second the longer largest —, and
 * the sampler the filter reads the half-size image with.
 */
export async function createMotionBlurPrograms(device: GPUDevice) {
  const layouts = motionBlurLayouts(device)
  const stage = (
    layoutOf: GPUBindGroupLayout,
    made: Promise<GPUShaderModule>,
    entryPoint: string,
    constants?: Record<string, number>,
  ) => blurStage(device, layoutOf, made, entryPoint, constants)
  const filters = createCheckedShaderModule(device, filterShader(), `${MOTION_BLUR_PASS} filter`)
  const scatter = createCheckedShaderModule(device, scatterShader(), `${MOTION_BLUR_PASS} scatter`)
  const [flatten, gather, classify, filterPipelines, scatterSmallest, scatterLargest] =
    await Promise.all([
      stage(
        layouts.flatten,
        createCheckedShaderModule(device, flattenShader(), `${MOTION_BLUR_PASS} flatten`),
        'flattenMotion',
      ),
      stage(
        layouts.gather,
        createCheckedShaderModule(device, gatherShader(), `${MOTION_BLUR_PASS} gather`),
        'dilateGather',
      ),
      stage(
        layouts.classify,
        createCheckedShaderModule(device, classifyShader(), `${MOTION_BLUR_PASS} classify`),
        'classifyTiles',
        groupWidthConstants(groupWidth(device.limits)),
      ),
      Promise.all(
        TILE_CLASSES.map((kind) =>
          stage(layouts.filter, filters, 'filterTiles', classConstants(kind)),
        ),
      ),
      scatterDraw(device, layouts.scatter, scatter, false),
      scatterDraw(device, layouts.scatter, scatter, true),
    ])
  const sampler = device.createSampler({
    label: `${MOTION_BLUR_PASS} sampler`,
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  return {
    layouts,
    kit: { flatten, gather, classify, filters: filterPipelines } satisfies Kit,
    scatterSmallest,
    scatterLargest,
    sampler,
  }
}

/** The motion blur's programs (`createMotionBlurPrograms`). */
export type MotionBlurPrograms = Awaited<ReturnType<typeof createMotionBlurPrograms>>
