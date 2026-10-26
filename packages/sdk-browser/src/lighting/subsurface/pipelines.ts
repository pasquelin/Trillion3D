import {
  COMPUTE,
  computeBufferEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
  computeSamplerEntry,
} from '../../gpu/core/computeBindings.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { hasTextureFormatsTier1 } from '../../gpu/core/textureFormatsTier.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import { hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { VECTOR_FORMAT } from '../../post/taa/velocityWgsl.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { preparedPipeline } from '../deferred/fullscreen.ts'
import {
  SSS_ARGUMENTS,
  SSS_BINDINGS,
  SSS_COLOUR_FORMAT,
  SSS_IDS_FORMAT,
  SSS_PARAMS_BYTES,
  SSS_TEXTURES,
  SSS_TILES,
} from './layout.ts'
import { sssArgsProgram, sssComputeProgram, sssRasterProgram } from './programs.ts'
import { subsurfaceShapeKey, type SubsurfaceShape } from './shape.ts'

const SHADED = COMPUTE | 2

/** The entries of group 0, every kernel's. */
function commonEntries(): GPUBindGroupLayoutEntry[] {
  const B = SSS_BINDINGS
  return [
    computeUniformEntry(B.params, { minBindingSize: SSS_PARAMS_BYTES }, SHADED | 1),
    ...hizDepthEntries(B.depth, SHADED),
    computeTextureEntry(B.normals, 'unfilterable-float', '2d', SHADED),
    computeTextureEntry(B.base, 'unfilterable-float', '2d', SHADED),
    computeTextureEntry(B.flags, 'uint', '2d', SHADED),
    computeTextureEntry(B.data, 'unfilterable-float', '2d', SHADED),
    computeTextureEntry(B.profiles, 'unfilterable-float', '2d', SHADED),
    computeTextureEntry(B.vectors, 'uint', '2d', SHADED),
    computeSamplerEntry(B.sampler, 'filtering', SHADED),
  ]
}

const label = (name: string) => `${SUBSURFACE_PASS} ${name}`

/** The layouts of the pass's bind groups. */
function programLayouts(device: GPUDevice, tier1: boolean) {
  const common = device.createBindGroupLayout({ label: label('common'), entries: commonEntries() })
  const textures = device.createBindGroupLayout({
    label: label('textures'),
    entries: [
      computeTextureEntry(SSS_TEXTURES.a, 'float'),
      computeTextureEntry(SSS_TEXTURES.b, 'float'),
      computeTextureEntry(SSS_TEXTURES.c, 'unfilterable-float'),
      computeTextureEntry(SSS_TEXTURES.ids, 'uint'),
      computeStorageTextureEntry(SSS_TEXTURES.out, SSS_COLOUR_FORMAT),
      computeStorageTextureEntry(SSS_TEXTURES.history, SSS_COLOUR_FORMAT),
      computeStorageTextureEntry(SSS_TEXTURES.idsOut, SSS_IDS_FORMAT(tier1)),
    ],
  })
  const none = device.createBindGroupLayout({ label: label('none'), entries: [] })
  const tiles = device.createBindGroupLayout({
    label: label('tiles'),
    entries: [SSS_TILES.counts, SSS_TILES.lists, SSS_TILES.masks].map((binding) =>
      computeBufferEntry(binding, 'storage'),
    ),
  })
  const args = device.createBindGroupLayout({
    label: label('arguments'),
    entries: [SSS_ARGUMENTS.dispatch, SSS_ARGUMENTS.draw].map((binding) =>
      computeBufferEntry(binding, 'storage'),
    ),
  })
  const raster = device.createBindGroupLayout({
    label: label('raster textures'),
    entries: [
      computeTextureEntry(SSS_TEXTURES.a, 'unfilterable-float', '2d', 2),
      computeTextureEntry(SSS_TEXTURES.b, 'float', '2d', 2),
    ],
  })
  const rasterLists = device.createBindGroupLayout({
    label: label('raster lists'),
    entries: [computeBufferEntry(SSS_TILES.lists, 'read-only-storage', 1)],
  })
  return { common, textures, none, tiles, args, raster, rasterLists }
}

type ProgramLayouts = ReturnType<typeof programLayouts>

/** The pipelines of each shape, prepared off the frame (`PreparedPipeline.ask`). */
function shapePrograms(device: GPUDevice, layouts: ProgramLayouts, tier1: boolean) {
  const { common, textures, none, tiles, args, raster, rasterLists } = layouts
  const layout = (...groups: GPUBindGroupLayout[]) =>
    device.createPipelineLayout({ bindGroupLayouts: groups })
  const kernelLayout = layout(common, textures, tiles)
  const argsLayout = layout(common, none, tiles, args)
  const tileLayout = layout(common, raster, rasterLists)
  const target = [{ format: SSS_COLOUR_FORMAT }]

  return preparedPipelines((shape: SubsurfaceShape) => {
    const kernels = device.createShaderModule({
      label: label('kernels'),
      code: sssComputeProgram(shape, tier1),
    })
    const argument = device.createShaderModule({
      label: label('arguments'),
      code: sssArgsProgram(shape),
    })
    const drawn = device.createShaderModule({
      label: label('draws'),
      code: sssRasterProgram(shape),
    })
    const kernel = (entry: string) =>
      preparedComputeStage(device, kernelLayout, kernels, entry, undefined, label(entry))
    const argKernel = (entry: string) =>
      preparedComputeStage(device, argsLayout, argument, entry, undefined, label(entry))
    const draw = (vertex: string, fragment: string) =>
      preparedPipeline(device, {
        label: label(`${fragment} ${vertex}`),
        layout: tileLayout,
        vertex: { module: drawn, entryPoint: vertex },
        fragment: { module: drawn, entryPoint: fragment, targets: target },
        primitive: { topology: 'triangle-list' },
      })
    return {
      mark: kernel('sssMark'),
      lists: kernel('sssLists'),
      clear: kernel('sssClear'),
      mip: kernel('sssMip'),
      setupMain: kernel('sssSetupMain'),
      setupPass: kernel('sssSetupPass'),
      sampled: kernel('sssSampledScatter'),
      variance: kernel('sssVariance'),
      horizontal: kernel('sssSeparableHorizontal'),
      vertical: kernel('sssSeparableVertical'),
      argsTiles: argKernel('sssArgsTiles'),
      argsScatter: argKernel('sssArgsScatter'),
      recombineTile: draw('sssTileVertex', 'sssRecombine'),
      copyTile: draw('sssTileVertex', 'sssCopy'),
    }
  }, subsurfaceShapeKey)
}

/** The stand-in textures and the sampler the groups bind where a pass reads none. */
function standIns(device: GPUDevice, tier1: boolean) {
  const black = standInTexture(device, label('black'), SSS_COLOUR_FORMAT, { storage: true })
  return {
    black: black.createView(),
    sinks: [0, 1].map(() =>
      standInTexture(device, label('sink'), SSS_COLOUR_FORMAT, { storage: true }).createView(),
    ) as [GPUTextureView, GPUTextureView],
    idsSink: standInTexture(device, label('ids sink'), SSS_IDS_FORMAT(tier1), {
      storage: true,
    }).createView(),
    ids: standInTexture(device, label('ids'), SSS_IDS_FORMAT(tier1)).createView(),
    noVectors: standInTexture(device, label('no vectors'), VECTOR_FORMAT).createView(),
    sampler: postSamplers(device).clamped,
  }
}

/** The programs of the pass on a device: the layouts of its groups, the stand-in textures the groups bind where a pass reads none,
 *  and the pipelines of a shape (`forShape`), each prepared off the frame (`PreparedPipeline.ask`). */
export const subsurfacePrograms = oncePerDevice((device: GPUDevice) => {
  const tier1 = hasTextureFormatsTier1(device.features)
  const layouts = programLayouts(device, tier1)
  const shapes = shapePrograms(device, layouts, tier1)
  return { tier1, ...layouts, shapes, ...standIns(device, tier1) }
})

/** The pipelines of a shape. */
export type ShapePipelines = ReturnType<ReturnType<typeof subsurfacePrograms>['shapes']['of']>

/** Whether the programs of `shape` are compiled, asking for them (the frame is held until they are). */
export function subsurfaceReady(shape: SubsurfaceShape, p: ShapePipelines) {
  const needed = [
    p.mark,
    p.lists,
    p.clear,
    p.setupMain,
    p.setupPass,
    p.argsTiles,
    p.recombineTile,
    p.copyTile,
    ...(shape.forceSeparable ? [] : [p.mip, p.sampled, p.variance, p.argsScatter]),
    p.horizontal,
    p.vertical,
  ]
  let ready = true
  for (const pipeline of needed) ready = pipeline.ask().ready && ready
  return ready
}
