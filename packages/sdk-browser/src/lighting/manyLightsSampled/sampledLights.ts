/**
 * THE SAMPLED LIGHTING OF AN IMAGE, as far as its samples (the first lot of its passes): `encodeSampledLights` classifies the surfaces into
 * tiles (`tileBitmaskWgsl`), cuts the tiles of the view and of the downsampled view into a list a mode and writes the arguments of the
 * dispatches over them (`tileListsWgsl`, `tileArgsWgsl`), draws the samples of the downsampled pixels (`samplingWgsl`; the empty tiles
 * cleared by `clearSamplesWgsl`) and sets the tiles' hashes of the lights they saw, which guide the next image (`hashWgsl`). It returns the
 * samples and the rays the later passes trace and shade.
 */
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  COMPUTE,
} from '../../gpu/core/computeBindings.ts'
import { askedComputeStage, preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { hasFloat32Filterable } from '../../gpu/core/float32Filterable.ts'
import { PHYSICAL_LOBES_TARGET } from '../../materials/surface/physicalLobes.ts'
import { SUBSURFACE_TARGET } from '../../materials/surface/subsurface.ts'
import { chainReady, type PreparedPipeline } from '../deferred/fullscreen.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { variantLabel, type ContractKey } from '../deferred/contractCuts.ts'
import { createPassGroup } from '../deferred/passGroup.ts'
import { CLASS_CUTS } from '../deferred/litSurfaceWgsl.ts'
import { TILE_CLASS, type TileClass } from '../deferred/tileClass.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import {
  lightProfileLayoutEntries,
  type LightProfileResources,
} from '../lightProfile/profileBindings.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { FRONT_TRACED_FORMAT } from '../reflections/frontLayer.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import {
  createLightComplexity,
  type ComplexityImage,
  type ComplexityRequest,
} from './debug/complexity/replay.ts'
import {
  COMPACT_ARGS_ENTRY,
  COMPACT_ENTRY,
  compactArgsAt,
  compactArgsWgsl,
  compactWgsl,
} from './compactWgsl.ts'
import {
  SOFTWARE_FIELD_BINDING,
  SOFTWARE_TRACE_ENTRY,
  softwareTraceWgsl,
} from './softwareTraceWgsl.ts'
import { globalReadLayoutEntries, type GlobalFieldRead } from '../distanceField/view.ts'
import { VSM_TRACE_BINDING, VSM_TRACE_ENTRY, vsmTraceSamplesWgsl } from './vsmTraceWgsl.ts'
import { SPATIAL_ENTRY, spatialWgsl } from './spatialWgsl.ts'
import { TEMPORAL_ENTRY, temporalWgsl } from './temporalWgsl.ts'
import { SHADING_ENTRY, shadingWgsl } from './shadingWgsl.ts'
import { SCREEN_TRACE_ENTRY, screenTraceWgsl } from './screenTraceWgsl.ts'
import { CLEAR_RESOLVED_ENTRY, clearResolvedWgsl } from './clearResolvedWgsl.ts'
import {
  FILTER_HASH_ENTRY,
  filterHashWgsl,
  HASH_ENTRY,
  hashFilterOn,
  hashWgsl,
} from './hashWgsl.ts'
import {
  SAMPLED_GROUP,
  guideAt,
  ranksAt,
  guideWords,
  sampledGeometry,
  tileArgsAt,
  tileArgsBytes,
  tileListWords,
  type SampledGeometry,
} from './layout.ts'
import {
  FRONT_LIGHT_BINDINGS,
  FRONT_LIGHT_ENTRY,
  FRONT_MARK,
  frontLightWgsl,
} from './frontLightWgsl.ts'
import { SAMPLED_PARAMS_WORDS, writeSampledParams } from './paramsWgsl.ts'
import {
  HAIR_SURFACE_OCCLUSION,
  HAIR_SURFACE_TRACE_ENTRY,
  HAIR_SURFACE_TRACE_SETTINGS,
  hairSurfaceTraceWgsl,
} from './hairSurfaceTraceWgsl.ts'
import type { HairVoxelSet } from '../../hair/voxelPass.ts'
import type { HairVoxelSettings } from '../../hair/inputs.ts'
import {
  SAMPLED_TILE,
  SAMPLED_TILE_MODES,
  sampledDownsampleFactor,
  sampledSamplesForInput,
  sampledSettingsOf,
  sampledSoftShadows,
  type SampledInput,
  type SampledLightsSettings,
} from './parameters.ts'
import { CLEAR_ENTRY, SAMPLE_ENTRY, clearSamplesWgsl, samplingWgsl } from './samplingWgsl.ts'
import { idleTooLong } from '../../gpu/core/idleKeep.ts'
import {
  TILE_ARGS_ENTRY,
  TILE_BITMASK_ENTRY,
  TILE_LISTS_ENTRY,
  tileArgsWgsl,
  tileBitmaskWgsl,
  tileListsWgsl,
} from './tileWgsl.ts'
import {
  FRONT_TILE_ARGS_ENTRY,
  FRONT_TILE_LIST_ENTRY,
  frontTileArgsWgsl,
  frontTileListWgsl,
} from './frontTilesWgsl.ts'
import type { FrontTiles } from '../reflections/frontTiles.ts'

const B = SAMPLED_BINDINGS
const D = DEFERRED_BINDINGS
const PASS: GPUComputePassDescriptor = { label: 'Trillion3D sampled lights' }

/** Which passes of an image `encode` records: the samples' (tiles, lists, the draw of the lights), the traces' (the rays, the hash of what each tile saw), or both. */
export type SampledPhase = 'all' | 'samples' | 'traces'

/** What an image of the sampled lighting reads of the frame. */
export interface SampledSurface {
  /** The colours and the words, every layer of each (`SurfaceBuffer.stores`). */
  stores(): readonly [GPUTextureView, GPUTextureView]
  /** The views of the surfaces, the emission and occlusion's at 2 (`SurfaceBuffer.views`). */
  views(): readonly GPUTextureView[]
  readonly subsurfaceView: GPUTextureView
  readonly lobesView: GPUTextureView
}

export interface SampledLightsInputs {
  surface: SampledSurface
  depth: GPUTextureView
  /** The view's uniform (`VIEW_WGSL`). */
  view: GPUBuffer
  /** The declared lights, the lists of the light grid, the ranks of the directional lights in the light buffer, the light functions' atlas and
   *  the light profiles (none where the key says the scene has none). */
  lights: GPUBuffer
  tiles: GPUBuffer
  sunRanks: GPUBuffer
  /** The toon buffer (`toonTablesBinding`), the profiles the toon pixels' lights are shaped by. */
  toonTables: GPUBuffer
  lightFunction: GPUTextureView
  lightProfile?: LightProfileResources
  /** Whether the rectangle lights' pictures are read (`sampledLightsTexturedRectLights`); else a rectangle is plain. */
  texturedRects: boolean
  /** The blue noise (`gpu/noise/blueNoiseTextures.ts`). */
  noise: GPUTextureView
  /** The surfaces' motion vectors of the image (`screenProbeVectors`), none where the stage measured none: the surfaces are taken as still. */
  vectors?: GPUTextureView
  /** The tiles the nearest translucent layer lights (the front pass's marks and their list): only these are classified; none, every tile of the view is. */
  frontTiles?: FrontTiles
  /** The view-projection (no jitter) of the image before, zeros for none. */
  previousViewProjection: ArrayLike<number>
  /** The reflection group (`reflectionGroup`): the depth pyramid the screen trace marches and the view it reads; none, no screen trace. */
  reflection?: GPUBindGroup
  /** The global distance field's reads (`surfaceHitReads`): the software trace marches it; none, no software trace. */
  field?: GlobalFieldRead
  /** The texture the spatial filter writes the debug views' values into (`spatialDebugWgsl.ts`), 2 texels a pixel each way; none, the filter is the plain one. */
  debugPixels?: GPUTextureView
  /** What the light complexity view asks of this image (`debug/complexity/`): the pixel to replay and where the list and the cost of every pixel go; none, nothing. */
  complexity?: ComplexityRequest
  /** The ratio of each light's power since the image before, as words (`lightPower.ts`). */
  power: GPUBuffer
  /** The strands' voxels where the view holds hair and `sampledLightsHairVoxelTraces` holds: the surfaces' rays the distance field traces are also marched through them; none, no hair is traced. */
  hairVoxels?: { set: HairVoxelSet; settings: HairVoxelSettings }
  /** The number of the image (`WebgpuRun.frame`): the guide of the image before is history only if this is the very next one. */
  image: number
  /** The shadows are classic shadow maps (`shadowVirtualEnable` off). */
  classicShadows: boolean
  /** The shadow maps' data this image (`DirectLightResources.vsm`): the maps' trace of the samples reads it; none, no map trace. */
  vsm?: {
    pageTable: GPUBuffer
    projectionData: GPUBuffer
    uniforms: GPUBuffer
    pool: GPUBuffer
    view: GPUBuffer
  }
  /** The frame's key, which the sampling's programs are cut by. */
  key: ContractKey
  settings: SampledLightsSettings
  /** What the pass lights: the surfaces, or the nearest translucent layer (the hair strands: `SampledInput`). */
  input: SampledInput
  width: number
  height: number
  /** The image's frame index, which the draw's noise and the downsample's jitter follow. */
  frame: number
  /** The lights the buffer holds (the guide keeps a ratio of each). */
  lightCount: number
  /** The lights that live in it (the store's and the simple lights' counts): the tail of `lightCount` holds none, and the history of the guide is copied for these alone. */
  liveLights: number
}

/** What the first lot of passes leaves for the next: the samples and their rays, the guide this image wrote, and the sizes. */
export interface SampledSamples {
  geometry: SampledGeometry
  samples: GPUTextureView
  rays: GPUTextureView
  tileBitmask: GPUTextureView
  /** The tiles of the downsampled view by mode, their count of each and the arguments of the dispatches over them. */
  downAllocator: GPUBuffer
  downData: GPUBuffer
  downArgs: GPUBuffer
  guide: GPUBuffer
  params: GPUBuffer
  /** The pixels' resolved light, demodulated: the diffuse (its alpha the shading confidence) and the specular (`shadingWgsl.ts`). */
  resolvedDiffuse: GPUTextureView
  resolvedSpecular: GPUTextureView
  /** The temporal filter's output of this image (the confidence in the alpha of the light): what the spatial filter reads. */
  filtered: {
    diffuse: GPUTextureView
    specular: GPUTextureView
    moments: GPUTextureView
    frames: GPUTextureView
  }
  /** The light the spatial filter leaves, demodulation put back: what the lit image adds for the sampled lights. */
  composite: GPUTextureView
  /** What the debug views read of the image (`debug/`): the counts of the rays each trace method got and of the tiles by mode, and the tiles' lists. */
  debug: {
    compactCount: GPUBuffer
    allocator: GPUBuffer
    data: GPUBuffer
    downAllocator: GPUBuffer
    downData: GPUBuffer
  }
}

const resolvedTexture = (device: GPUDevice, label: string, size: readonly [number, number]) =>
  device.createTexture({
    label,
    size: [Math.max(1, size[0]), Math.max(1, size[1])],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The temporal filter's history: the diffuse and specular light (the confidence in the alpha), the moments, and the frames with the depth; two sets, taking turns. */
const historySet = (device: GPUDevice, size: readonly [number, number], at: number) => {
  const make = (label: string, format: GPUTextureFormat) =>
    device.createTexture({
      label: `Trillion3D sampled ${label} ${at}`,
      size: [Math.max(1, size[0]), Math.max(1, size[1])],
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const textures = {
    diffuse: make('filtered diffuse', 'rgba16float'),
    specular: make('filtered specular', 'rgba16float'),
    moments: make('moments', 'rgba16float'),
    frames: make('frames', 'rg32uint'),
  }
  return {
    ...textures,
    views: {
      diffuse: textures.diffuse.createView(),
      specular: textures.specular.createView(),
      moments: textures.moments.createView(),
      frames: textures.frames.createView(),
    },
    exposure: device.createBuffer({
      label: `Trillion3D sampled exposure ${at}`,
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    destroy() {
      for (const resource of [...Object.values(textures), this.exposure]) resource.destroy()
    },
  }
}

const storageBuffer = (device: GPUDevice, label: string, bytes: number, extra = 0) =>
  device.createBuffer({
    label,
    size: Math.max(16, bytes),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extra,
  })

const texture = (device: GPUDevice, label: string, size: readonly [number, number]) =>
  device.createTexture({
    label,
    size: [Math.max(1, size[0]), Math.max(1, size[1])],
    format: 'r32uint',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

/** The resources of one size of image: the tiles' bits, the lists by mode of the view's tiles and of the downsampled view's, the samples. */
function makeResources(device: GPUDevice, g: SampledGeometry, lights: number) {
  const modes = SAMPLED_TILE_MODES
  const guideBytes = guideWords(g, lights) * 4
  const bitmask = texture(device, 'Trillion3D sampled tile bits', g.tiles)
  const samples = texture(device, 'Trillion3D light samples', g.sampleView)
  const rays = texture(device, 'Trillion3D light sample rays', g.sampleView)
  const resolvedDiffuse = resolvedTexture(device, 'Trillion3D sampled diffuse', g.view)
  const resolvedSpecular = resolvedTexture(device, 'Trillion3D sampled specular', g.view)
  const composite = resolvedTexture(device, 'Trillion3D sampled composite', g.view)
  const resources = {
    geometry: g,
    lights,
    bitmask,
    bitmaskView: bitmask.createView(),
    samples,
    samplesView: samples.createView(),
    rays,
    raysView: rays.createView(),
    resolvedDiffuse,
    resolvedDiffuseView: resolvedDiffuse.createView(),
    resolvedSpecular,
    resolvedSpecularView: resolvedSpecular.createView(),
    composite,
    compositeView: composite.createView(),
    histories: [historySet(device, g.view, 0), historySet(device, g.view, 1)] as const,
    allocator: storageBuffer(
      device,
      'Trillion3D sampled tiles count',
      modes * 4,
      GPUBufferUsage.COPY_SRC,
    ),
    data: storageBuffer(device, 'Trillion3D sampled tiles', tileListWords(g) * 4),
    args: storageBuffer(
      device,
      'Trillion3D sampled tiles args',
      tileArgsBytes(),
      GPUBufferUsage.INDIRECT,
    ),
    downAllocator: storageBuffer(
      device,
      'Trillion3D sampled down tiles count',
      modes * 4,
      GPUBufferUsage.COPY_SRC,
    ),
    downData: storageBuffer(device, 'Trillion3D sampled down tiles', tileListWords(g) * 4),
    downArgs: storageBuffer(
      device,
      'Trillion3D sampled down tiles args',
      tileArgsBytes(),
      GPUBufferUsage.INDIRECT,
    ),
    compactData: storageBuffer(
      device,
      'Trillion3D sampled trace list',
      g.sampleView[0] * g.sampleView[1] * 12,
    ),
    compactCount: storageBuffer(
      device,
      'Trillion3D sampled trace count',
      16,
      GPUBufferUsage.COPY_SRC,
    ),
    compactArgs: storageBuffer(
      device,
      'Trillion3D sampled trace args',
      48,
      GPUBufferUsage.INDIRECT,
    ),
    hashRaw: storageBuffer(device, 'Trillion3D sampled raw hash', guideWords(g, 0) * 4),
    guides: [
      storageBuffer(device, 'Trillion3D sampled guide 0', guideBytes),
      storageBuffer(device, 'Trillion3D sampled guide 1', guideBytes),
    ] as const,
    params: device.createBuffer({
      label: 'Trillion3D sampled params',
      size: SAMPLED_PARAMS_WORDS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    destroy() {
      for (const resource of [
        bitmask,
        samples,
        rays,
        resolvedDiffuse,
        resolvedSpecular,
        composite,
        resources.allocator,
        resources.data,
        resources.args,
        resources.downAllocator,
        resources.downData,
        resources.downArgs,
        resources.compactData,
        resources.compactCount,
        resources.compactArgs,
        resources.hashRaw,
        ...resources.guides,
        ...resources.histories,
        resources.params,
      ])
        resource.destroy()
    },
  }
  return resources
}
type Resources = ReturnType<typeof makeResources>

/** The layout entries every kernel over the pixels' layers starts from: the words, the depth, the view and the lights. */
const geometryLayoutEntries = () => [
  computeTextureEntry(D.words, 'uint', '2d-array'),
  computeTextureEntry(D.depth, 'depth', '2d'),
  computeBufferEntry(D.view, 'uniform'),
  computeBufferEntry(D.lights, 'read-only-storage'),
]

/** The layout entries of the colours and the emissive and occlusion layer, then the geometry's. */
const shadedLayoutEntries = () => [
  computeTextureEntry(D.colours, 'unfilterable-float', '2d-array'),
  computeTextureEntry(D.emissiveAo, 'unfilterable-float', '2d'),
  ...geometryLayoutEntries(),
]

/** The layout entries of the samples and rays textures the traces read and write in place, then the compacted rays they read. */
const traceTailLayoutEntries = () => [
  computeStorageTextureEntry(B.samples, 'r32uint', 'read-write'),
  computeStorageTextureEntry(B.rays, 'r32uint', 'read-write'),
  computeBufferEntry(B.compactData, 'read-only-storage'),
  computeBufferEntry(B.compactCount, 'read-only-storage'),
]

/** The layouts of the tiles' classification and of the lists it makes. */
function tileLayouts(layout: (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout) {
  const pixel = [...geometryLayoutEntries(), computeBufferEntry(D.tiles, 'read-only-storage')]
  return {
    bitmask: layout([...pixel, computeStorageTextureEntry(B.tileBitmask, 'r32uint', 'write-only')]),
    // The bits of the listed tiles of the layer: the same, and the count and the list read.
    bitmaskListed: layout([
      ...pixel,
      computeStorageTextureEntry(B.tileBitmask, 'r32uint', 'write-only'),
      computeBufferEntry(B.tileAllocator, 'read-only-storage'),
      computeBufferEntry(B.tileData, 'read-only-storage'),
    ]),
    // The list's build: the front pass's marks, the bits cleared, the count and the list.
    frontList: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeStorageTextureEntry(B.frontMask, 'r32uint', 'read-only'),
      computeStorageTextureEntry(B.tileBitmask, 'r32uint', 'write-only'),
      computeBufferEntry(B.tileAllocator, 'storage'),
      computeBufferEntry(B.tileData, 'storage'),
    ]),
    lists: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeTextureEntry(B.tileBitmask, 'uint'),
      computeBufferEntry(B.tileAllocator, 'storage'),
      computeBufferEntry(B.tileData, 'storage'),
    ]),
    args: layout([
      computeBufferEntry(B.tileAllocator, 'read-only-storage'),
      computeBufferEntry(B.tileArgs, 'storage'),
    ]),
    hash: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeTextureEntry(B.samples, 'uint'),
      computeBufferEntry(B.hashRaw, 'storage'),
    ]),
    filterHash: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(B.hashRaw, 'read-only-storage'),
      computeBufferEntry(B.guideCurrent, 'storage'),
    ]),
    compactArgs: layout([
      computeBufferEntry(B.compactCount, 'read-only-storage'),
      computeBufferEntry(B.compactArgs, 'storage'),
    ]),
    clearResolved: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(B.tileAllocator, 'read-only-storage'),
      computeBufferEntry(B.tileData, 'read-only-storage'),
      computeStorageTextureEntry(B.resolvedDiffuse, 'rgba16float', 'write-only'),
      computeStorageTextureEntry(B.resolvedSpecular, 'rgba16float', 'write-only'),
    ]),
    clear: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(B.downAllocator, 'read-only-storage'),
      computeBufferEntry(B.downData, 'read-only-storage'),
      computeStorageTextureEntry(B.samples, 'r32uint', 'write-only'),
      computeStorageTextureEntry(B.rays, 'r32uint', 'write-only'),
    ]),
  }
}

/** The layouts of the rays' compaction and of the traces; `filterableMip` is whether the software trace reads the field's coarse mip through
 *  the hardware's filter (`softwareTraceWgsl`). */
function traceLayouts(
  layout: (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout,
  filterableMip: boolean,
) {
  return {
    trace: layout([
      computeTextureEntry(D.colours, 'unfilterable-float', '2d-array'),
      computeTextureEntry(D.words, 'uint', '2d-array'),
      computeBufferEntry(B.params, 'uniform'),
      ...traceTailLayoutEntries(),
    ]),
    compact: layout([
      computeBufferEntry(B.params, 'uniform'),
      computeStorageTextureEntry(B.rays, 'r32uint', 'read-write'),
      computeStorageTextureEntry(B.samples, 'r32uint', 'read-write'),
      computeBufferEntry(D.lights, 'read-only-storage'),
      computeBufferEntry(B.compactData, 'storage'),
      computeBufferEntry(B.compactCount, 'storage'),
    ]),
    software: layout([
      computeBufferEntry(D.lights, 'read-only-storage'),
      computeBufferEntry(B.params, 'uniform'),
      ...traceTailLayoutEntries(),
      ...globalReadLayoutEntries(SOFTWARE_FIELD_BINDING, filterableMip),
    ]),
    hairTrace: layout([
      computeBufferEntry(D.lights, 'read-only-storage'),
      computeBufferEntry(0, 'uniform'),
      computeBufferEntry(1, 'read-only-storage'),
      computeBufferEntry(2, 'read-only-storage'),
      computeBufferEntry(3, 'read-only-storage'),
      computeBufferEntry(B.params, 'uniform'),
      computeBufferEntry(HAIR_SURFACE_TRACE_SETTINGS, 'uniform'),
      ...traceTailLayoutEntries(),
    ]),
    vsm: layout([
      computeTextureEntry(D.colours, 'unfilterable-float', '2d-array'),
      computeBufferEntry(D.lights, 'read-only-storage'),
      computeBufferEntry(VSM_TRACE_BINDING.uniforms, 'uniform'),
      computeBufferEntry(VSM_TRACE_BINDING.pageTable, 'read-only-storage'),
      computeBufferEntry(VSM_TRACE_BINDING.projectionData, 'read-only-storage'),
      computeBufferEntry(VSM_TRACE_BINDING.pool, 'read-only-storage'),
      computeBufferEntry(VSM_TRACE_BINDING.view, 'uniform'),
      computeTextureEntry(VSM_TRACE_BINDING.noise, 'unfilterable-float'),
      computeBufferEntry(B.params, 'uniform'),
      ...traceTailLayoutEntries(),
    ]),
  }
}

/** The layouts of the temporal and spatial denoisers. */
function denoiseLayouts(layout: (entries: GPUBindGroupLayoutEntry[]) => GPUBindGroupLayout) {
  const spatial = [
    ...shadedLayoutEntries(),
    lightFunctionLayoutEntry(D.lightFunctionAtlas),
    computeBufferEntry(B.params, 'uniform'),
    computeTextureEntry(B.resolvedDiffuse, 'unfilterable-float'),
    computeTextureEntry(B.filteredDiffuse, 'unfilterable-float'),
    computeTextureEntry(B.filteredSpecular, 'unfilterable-float'),
    computeTextureEntry(B.filteredMoments, 'unfilterable-float'),
    computeTextureEntry(B.filteredFrames, 'uint'),
    computeStorageTextureEntry(B.composite, 'rgba16float', 'write-only'),
    { ...SUBSURFACE_TARGET.layoutEntry(), visibility: COMPUTE },
    { ...PHYSICAL_LOBES_TARGET.layoutEntry(), visibility: COMPUTE },
  ]
  return {
    spatial: layout(spatial),
    spatialDebug: layout([
      ...spatial,
      computeStorageTextureEntry(B.debugPixels, 'rgba32float', 'write-only'),
    ]),
    temporal: layout([
      computeTextureEntry(D.colours, 'unfilterable-float', '2d-array'),
      computeTextureEntry(D.words, 'uint', '2d-array'),
      computeBufferEntry(B.params, 'uniform'),
      computeTextureEntry(B.resolvedDiffuse, 'unfilterable-float'),
      computeTextureEntry(B.resolvedSpecular, 'unfilterable-float'),
      computeTextureEntry(B.historyDiffuse, 'float'),
      computeTextureEntry(B.historySpecular, 'float'),
      computeTextureEntry(B.historyMoments, 'unfilterable-float'),
      computeTextureEntry(B.historyFrames, 'uint'),
      computeStorageTextureEntry(B.filteredDiffuse, 'rgba16float', 'write-only'),
      computeStorageTextureEntry(B.filteredSpecular, 'rgba16float', 'write-only'),
      computeStorageTextureEntry(B.filteredMoments, 'rgba16float', 'write-only'),
      computeStorageTextureEntry(B.filteredFrames, 'rg32uint', 'write-only'),
      computeSamplerEntry(B.historySampler, 'filtering'),
      computeBufferEntry(B.exposureBefore, 'read-only-storage'),
      computeBufferEntry(B.exposureNow, 'storage'),
      computeTextureEntry(B.vectors, 'uint'),
    ]),
  }
}

/** The layouts of the kernels, by what they read. */
function makeLayouts(device: GPUDevice) {
  const layout = (entries: GPUBindGroupLayoutEntry[]) => device.createBindGroupLayout({ entries })
  return {
    ...tileLayouts(layout),
    ...traceLayouts(layout, hasFloat32Filterable(device.features)),
    ...denoiseLayouts(layout),
  }
}

/** The layout entries every kernel that weighs the lights of a pixel starts with: the pixel's layers, the lights, the light grid, the suns' ranks, the light functions, the light profiles where
 *  the scene has some, and the uniform. */
function weighingLayoutEntries(key: ContractKey): GPUBindGroupLayoutEntry[] {
  return [
    ...shadedLayoutEntries(),
    computeBufferEntry(D.tiles, 'read-only-storage'),
    computeBufferEntry(D.sunRanks, 'read-only-storage'),
    computeBufferEntry(D.toonTables, 'read-only-storage'),
    lightFunctionLayoutEntry(D.lightFunctionAtlas),
    ...(key.profileless
      ? []
      : lightProfileLayoutEntries({
          atlas: D.lightProfileAtlas,
          sampler: D.lightProfileSampler,
          rectAtlas: D.rectAtlas,
          rectSampler: D.rectAtlasSampler,
        })),
    computeBufferEntry(B.params, 'uniform'),
  ]
}

/** The entries the sampling reads of the last image's guide: the guide, the blue noise and the surfaces' vectors. */
const guideLayoutEntries = (): GPUBindGroupLayoutEntry[] => [
  computeBufferEntry(B.guideHistory, 'read-only-storage'),
  computeTextureEntry(B.blue, 'unfilterable-float'),
  computeTextureEntry(B.vectors, 'uint'),
]

/** The thin and lobe targets a class reads, as read-only entries. */
function classTargetLayoutEntries(tileClass: TileClass): GPUBindGroupLayoutEntry[] {
  const cut = CLASS_CUTS[tileClass]
  const readOnlyTarget = (entry: GPUBindGroupLayoutEntry) => ({ ...entry, visibility: COMPUTE })
  return [
    ...(cut.thin ? [readOnlyTarget(SUBSURFACE_TARGET.layoutEntry())] : []),
    ...(cut.lobes ? [readOnlyTarget(PHYSICAL_LOBES_TARGET.layoutEntry())] : []),
  ]
}

/** The layout of the sampling of a class, under a key: the weighing's entries, the draw's lists and
 *  outputs and the guide, or the shading's lists, samples and resolve, then the thin and lobe targets the class reads. */
function samplingLayout(
  device: GPUDevice,
  key: ContractKey,
  tileClass: TileClass,
  shading = false,
) {
  return device.createBindGroupLayout({
    entries: [
      ...weighingLayoutEntries(key),
      ...(shading
        ? [
            // The view's lists of tiles by mode, the samples as they were left, and what the shading resolves.
            computeBufferEntry(B.tileAllocator, 'read-only-storage'),
            computeBufferEntry(B.tileData, 'read-only-storage'),
            computeTextureEntry(B.samples, 'uint'),
            computeStorageTextureEntry(B.resolvedDiffuse, 'rgba16float', 'write-only'),
            computeStorageTextureEntry(B.resolvedSpecular, 'rgba16float', 'write-only'),
            computeTextureEntry(B.blue, 'unfilterable-float'),
          ]
        : [
            computeBufferEntry(B.downAllocator, 'read-only-storage'),
            computeBufferEntry(B.downData, 'read-only-storage'),
            computeStorageTextureEntry(B.samples, 'r32uint', 'write-only'),
            computeStorageTextureEntry(B.rays, 'r32uint', 'write-only'),
            ...guideLayoutEntries(),
          ]),
      ...classTargetLayoutEntries(tileClass),
    ],
  })
}

/** The modes whose tiles a class samples, and the class and variant that sample them: modes of the textured rectangle variants run the
 *  code of the rectangle's (the engine has no light textured by an image). */
const SAMPLING_MODES: readonly { mode: number; tileClass: TileClass; rect: boolean }[] = [
  { mode: SAMPLED_TILE.simple, tileClass: TILE_CLASS.simple, rect: false },
  { mode: SAMPLED_TILE.simpleRect, tileClass: TILE_CLASS.simple, rect: true },
  { mode: SAMPLED_TILE.simpleRectTextured, tileClass: TILE_CLASS.simple, rect: true },
  { mode: SAMPLED_TILE.single, tileClass: TILE_CLASS.single, rect: false },
  { mode: SAMPLED_TILE.singleRect, tileClass: TILE_CLASS.single, rect: true },
  { mode: SAMPLED_TILE.singleRectTextured, tileClass: TILE_CLASS.single, rect: true },
  { mode: SAMPLED_TILE.complex, tileClass: TILE_CLASS.complex, rect: false },
  { mode: SAMPLED_TILE.complexRect, tileClass: TILE_CLASS.complex, rect: true },
  { mode: SAMPLED_TILE.complexRectTextured, tileClass: TILE_CLASS.complex, rect: true },
]

type Stage = PreparedPipeline<GPUComputePipeline>

/** The pipelines of the tiles' classification, of the compaction of the rays and of the clearing of the samples. */
function createTileStages(device: GPUDevice, layouts: Layouts, stage: StageMaker, front: boolean) {
  const listsModule = device.createShaderModule({
    label: 'Trillion3D sampled tiles',
    code: tileListsWgsl(),
  })
  const compactModule = device.createShaderModule({
    label: 'Trillion3D sampled compact',
    code: compactWgsl(),
  })
  const compactArgsModule = device.createShaderModule({
    label: 'Trillion3D sampled compact args',
    code: compactArgsWgsl(),
  })
  return {
    // The nearest translucent layer's: the list of the tiles its pass marked, the arguments over it and the bits of those tiles alone.
    frontTiles: front
      ? {
          list: stage(
            layouts.frontList,
            device.createShaderModule({
              label: 'Trillion3D sampled front tiles',
              code: frontTileListWgsl(),
            }),
            FRONT_TILE_LIST_ENTRY,
            'Trillion3D sampled front tiles',
          ),
          args: stage(
            layouts.args,
            device.createShaderModule({
              label: 'Trillion3D sampled front tiles args',
              code: frontTileArgsWgsl(),
            }),
            FRONT_TILE_ARGS_ENTRY,
            'Trillion3D sampled front tiles args',
          ),
          bitmask: stage(
            layouts.bitmaskListed,
            device.createShaderModule({
              label: 'Trillion3D sampled front tile bits',
              code: tileBitmaskWgsl(true),
            }),
            TILE_BITMASK_ENTRY,
            'Trillion3D sampled front tile bits',
          ),
        }
      : undefined,
    fixed: {
      bitmask: stage(
        layouts.bitmask,
        device.createShaderModule({
          label: 'Trillion3D sampled tile bits',
          code: tileBitmaskWgsl(),
        }),
        TILE_BITMASK_ENTRY,
        'Trillion3D sampled tile bits',
      ),
      listView: stage(layouts.lists, listsModule, TILE_LISTS_ENTRY, 'Trillion3D sampled tiles', {
        DOWNSAMPLED: 0,
      }),
      listDown: stage(
        layouts.lists,
        listsModule,
        TILE_LISTS_ENTRY,
        'Trillion3D sampled down tiles',
        { DOWNSAMPLED: 1 },
      ),
      args: stage(
        layouts.args,
        device.createShaderModule({ label: 'Trillion3D sampled tiles args', code: tileArgsWgsl() }),
        TILE_ARGS_ENTRY,
        'Trillion3D sampled tiles args',
      ),
      hash: stage(
        layouts.hash,
        device.createShaderModule({ label: 'Trillion3D sampled hash', code: hashWgsl() }),
        HASH_ENTRY,
        'Trillion3D sampled hash',
      ),
      filterHash: stage(
        layouts.filterHash,
        device.createShaderModule({
          label: 'Trillion3D sampled hash filter',
          code: filterHashWgsl(),
        }),
        FILTER_HASH_ENTRY,
        'Trillion3D sampled hash filter',
      ),
    },
    compacts: [0, 1, 2].map((slot) => ({
      list: stage(layouts.compact, compactModule, COMPACT_ENTRY, 'Trillion3D sampled compact', {
        MODE: slot,
      }),
      args: stage(
        layouts.compactArgs,
        compactArgsModule,
        COMPACT_ARGS_ENTRY,
        'Trillion3D sampled compact args',
        { SLOT: slot },
      ),
    })),
    clearResolved: stage(
      layouts.clearResolved,
      device.createShaderModule({
        label: 'Trillion3D sampled clear resolved',
        code: clearResolvedWgsl(),
      }),
      CLEAR_RESOLVED_ENTRY,
      'Trillion3D sampled clear resolved',
      { TILE_MODE: SAMPLED_TILE.empty },
    ),
    clears: stage(
      layouts.clear,
      device.createShaderModule({ label: 'Trillion3D sampled clear', code: clearSamplesWgsl() }),
      CLEAR_ENTRY,
      'Trillion3D sampled clear',
      { TILE_MODE: SAMPLED_TILE.empty },
    ),
  }
}

/** The pipelines of the rays' traces: the screen's, the maps' (virtual and classic), the distance field's and, asked at the first image that has hair to trace, the strands' voxels'. */
function createTraceStages(
  device: GPUDevice,
  failed: (error: unknown) => void,
  layouts: Layouts,
  stage: StageMaker,
) {
  const traceStage = askedComputeStage(
    device,
    [layouts.trace, reflectionLayout(device)],
    screenTraceWgsl(),
    SCREEN_TRACE_ENTRY,
    'Trillion3D sampled screen trace',
    failed,
  )
  // The trace through the maps reads them as the virtual maps, or, with the classic shadow maps, by the classic filter.
  const vsmStages = [false, true].map((classic) =>
    askedComputeStage(
      device,
      [layouts.vsm, reflectionLayout(device)],
      vsmTraceSamplesWgsl(classic),
      VSM_TRACE_ENTRY,
      'Trillion3D sampled map trace',
      failed,
    ),
  )
  const softwareStage = askedComputeStage(
    device,
    [layouts.software, reflectionLayout(device)],
    softwareTraceWgsl(hasFloat32Filterable(device.features)),
    SOFTWARE_TRACE_ENTRY,
    'Trillion3D sampled software trace',
    failed,
  )
  // The strands' voxels march of the surfaces' rays (`hairSurfaceTraceWgsl.ts`), its pipeline asked at the first image that has hair to trace.
  let hairTraceStage: Stage | undefined
  const hairTrace = () =>
    (hairTraceStage ??= stage(
      layouts.hairTrace,
      device.createShaderModule({
        label: 'Trillion3D sampled hair voxel trace',
        code: hairSurfaceTraceWgsl(),
      }),
      HAIR_SURFACE_TRACE_ENTRY,
      'Trillion3D sampled hair voxel trace',
    ))
  const hairTraceSettings = device.createBuffer({
    label: 'Trillion3D sampled hair voxel trace settings',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  return { traceStage, vsmStages, softwareStage, hairTrace, hairTraceSettings }
}

/** The pipelines of the temporal and spatial filters, and the sampler the temporal one reads the history by. */
function createFilterStages(device: GPUDevice, failed: (error: unknown) => void, layouts: Layouts) {
  return {
    temporalStage: askedComputeStage(
      device,
      [layouts.temporal, reflectionLayout(device)],
      temporalWgsl(),
      TEMPORAL_ENTRY,
      'Trillion3D sampled temporal filter',
      failed,
    ),
    spatialStage: askedComputeStage(
      device,
      [layouts.spatial],
      spatialWgsl(),
      SPATIAL_ENTRY,
      'Trillion3D sampled spatial filter',
      failed,
    ),
    historySampler: device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    }),
  }
}

/** The copy of the layer's light to where the blend reads it (`frontLightWgsl.ts`): a pipeline under each mark, and the layout of the group (a view's own) it binds. */
function createFrontLight(device: GPUDevice, stage: StageMaker) {
  const layout = device.createBindGroupLayout({
    entries: [
      computeTextureEntry(FRONT_LIGHT_BINDINGS.composite, 'unfilterable-float'),
      computeTextureEntry(FRONT_LIGHT_BINDINGS.words, 'uint', '2d-array'),
      computeStorageTextureEntry(FRONT_LIGHT_BINDINGS.traced, FRONT_TRACED_FORMAT, 'write-only'),
    ],
  })
  const module = device.createShaderModule({
    label: 'Trillion3D sampled front light',
    code: frontLightWgsl(),
  })
  const stages = new Map<number, Stage>()
  /** The pipeline that copies the layer's light under the mark (`FRONT_MARK`) its fragments read the layer by. */
  const stageOf = (mark: number) => {
    let made = stages.get(mark)
    if (!made)
      stages.set(
        mark,
        (made = stage(layout, module, FRONT_LIGHT_ENTRY, 'Trillion3D sampled front light', {
          MARK: mark,
        })),
      )
    return made
  }
  return {
    layout,
    /**
     * Copies the light the sampled lighting left for the nearest translucent layer (`composite`, the image's) into the second half of the front's traced radiance `traced` (twice
     * the view tall), the layer's `words` marking where it holds a surface (`frontLightWgsl.ts`). False while the kernel compiles.
     */
    pack(
      group: ReturnType<typeof createPassGroup>,
      encoder: GPUCommandEncoder,
      composite: GPUTextureView,
      words: GPUTextureView,
      traced: GPUTextureView,
      size: readonly [number, number],
      mark: number = FRONT_MARK.lit,
    ) {
      const made = stageOf(mark).get()
      if (!made) return false
      const bound = group.get([composite, words, traced], () => [
        { binding: FRONT_LIGHT_BINDINGS.composite, resource: composite },
        { binding: FRONT_LIGHT_BINDINGS.words, resource: words },
        { binding: FRONT_LIGHT_BINDINGS.traced, resource: traced },
      ])
      const pass = encoder.beginComputePass(PASS)
      pass.setPipeline(made)
      pass.setBindGroup(0, bound)
      pass.dispatchWorkgroups(ceilDiv(size[0], SAMPLED_GROUP), ceilDiv(size[1], SAMPLED_GROUP))
      pass.end()
      return true
    },
  }
}

/** The bind groups of every pass, kept while what they name holds. */
function createGroups(device: GPUDevice, layouts: Layouts) {
  return {
    bitmask: createPassGroup(device, layouts.bitmask),
    bitmaskListed: createPassGroup(device, layouts.bitmaskListed),
    frontList: createPassGroup(device, layouts.frontList),
    frontArgs: createPassGroup(device, layouts.args),
    listView: createPassGroup(device, layouts.lists),
    listDown: createPassGroup(device, layouts.lists),
    argsView: createPassGroup(device, layouts.args),
    argsDown: createPassGroup(device, layouts.args),
    hash: createPassGroup(device, layouts.hash),
    filterHash: createPassGroup(device, layouts.filterHash),
    clear: createPassGroup(device, layouts.clear),
    clearResolved: createPassGroup(device, layouts.clearResolved),
    trace: createPassGroup(device, layouts.trace),
    compact: createPassGroup(device, layouts.compact),
    compactArgs: [0, 1, 2].map(() => createPassGroup(device, layouts.compactArgs)),
    software: createPassGroup(device, layouts.software),
    hairTrace: createPassGroup(device, layouts.hairTrace),
    vsm: createPassGroup(device, layouts.vsm),
    temporal: createPassGroup(device, layouts.temporal),
    spatial: createPassGroup(device, layouts.spatial),
    spatialDebug: createPassGroup(device, layouts.spatialDebug),
  }
}

/** The sampling's pipelines of a key, a stage a mode, and a group a class. */
interface SamplingFamily {
  label: string
  stages: Map<number, Stage>
  shading: Map<number, Stage>
  layouts: Map<TileClass, GPUBindGroupLayout>
  shadingLayouts: Map<TileClass, GPUBindGroupLayout>
}

/**
 * The sampling's family of each label asked, made once and shared by the views (their groups over it follow the family itself, `samplingGroupsOf`): views asking different labels do not remake it.
 * A family no view asked for for `IDLE_KEEP_IMAGES` ticks of the kit (one a lit image, asking or not: `tick`) is let go with its pipelines and layouts, the next ask making it again; the count is
 * of images, so a hidden tab or a slow device frees nothing early, and a sampled lighting turned off frees its families.
 */
function createSamplingCache(device: GPUDevice, stage: StageMaker, front: boolean) {
  const families = new Map<string, { family: SamplingFamily; askedAt: number }>()
  let ticks = 0
  return {
    /** Counts one lit image (the caller counts an image once) and lets go of the families nobody asked for during `IDLE_KEEP_IMAGES` of them. */
    tick() {
      ticks++
      for (const [held, { askedAt }] of families)
        if (idleTooLong(ticks, askedAt)) families.delete(held)
    },
    /** `held` is the family the asking view still holds: a pruned family it still reads is registered again, never rebuilt beside it. */
    samplingFor(key: ContractKey, textured: boolean, held?: SamplingFamily): SamplingFamily {
      // The toon data is left out of the label: the sampling is ramped light by light under either key, its code and layouts the same.
      const label = `${variantLabel({ ...key, toonData: false })}${textured ? '' : ' plain rectangles'}`
      const made =
        families.get(label) ?? (held?.label === label ? { family: held, askedAt: 0 } : undefined)
      if (made) {
        made.askedAt = ticks
        families.set(label, made)
        return made.family
      }
      const classLayouts = new Map<TileClass, GPUBindGroupLayout>()
      const stages = new Map<number, Stage>()
      const shading = new Map<number, Stage>()
      const shadingLayouts = new Map<TileClass, GPUBindGroupLayout>()
      for (const { mode, tileClass, rect } of SAMPLING_MODES) {
        let shadingLayout = shadingLayouts.get(tileClass)
        if (!shadingLayout)
          shadingLayouts.set(
            tileClass,
            (shadingLayout = samplingLayout(device, key, tileClass, true)),
          )
        shading.set(
          mode,
          stage(
            shadingLayout,
            device.createShaderModule({
              label: 'Trillion3D sampled shading',
              code: wgslModule(shadingWgsl(key, tileClass, rect, textured)),
            }),
            SHADING_ENTRY,
            `Trillion3D sampled shading ${mode}`,
            { TILE_MODE: mode },
          ),
        )
        let layout = classLayouts.get(tileClass)
        if (!layout) classLayouts.set(tileClass, (layout = samplingLayout(device, key, tileClass)))
        const module = device.createShaderModule({
          label: 'Trillion3D sampled lights',
          code: wgslModule(samplingWgsl(key, tileClass, rect, front, textured)),
        })
        stages.set(
          mode,
          stage(layout, module, SAMPLE_ENTRY, `Trillion3D sampled lights ${mode}`, {
            TILE_MODE: mode,
          }),
        )
      }
      const family = { label, stages, shading, layouts: classLayouts, shadingLayouts }
      families.set(label, { family, askedAt: ticks })
      return family
    },
  }
}

type Layouts = ReturnType<typeof makeLayouts>
type StageMaker = (
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entry: string,
  label: string,
  constants?: Record<string, number>,
) => Stage

/** Everything a kit holds for a device: its pipelines, its groups, the sampling's family and what the last image left. */
interface Kit {
  device: GPUDevice
  stages: ReturnType<typeof createTileStages> &
    ReturnType<typeof createTraceStages> &
    ReturnType<typeof createFilterStages>
  layouts: Layouts
  /** The layout of the front light's group, a view's own group naming it. */
  frontLightLayout: GPUBindGroupLayout
  cache: ReturnType<typeof createSamplingCache>
  /** The spatial filter with the debug output, compiled at the first image a view asks for it. */
  spatialDebug: () => Stage
  /** The light complexity view's replay and cost, made at the first image that asks. */
  complexity: () => ReturnType<typeof createLightComplexity>
  /** The stand-in for the motion vectors of an input that has none, made at the first image that needs it and retired with the kit. */
  noVectors?: { texture: GPUTexture; view: GPUTextureView }
}

/** The groups of the sampling and of the shading of a view, a pair per tile class, over the family they were made for. */
interface SamplingGroups {
  family: SamplingFamily
  sample: Map<TileClass, ReturnType<typeof createPassGroup>>
  shade: Map<TileClass, ReturnType<typeof createPassGroup>>
}

/** What a view keeps of its sampled lighting (held by the view's record, `release.ts`): the guide and the hash sets live in its resources, and the bind groups over them are its own (two views alternating would remake the groups of a shared one every image). */
export interface SampledKitState {
  groups: ReturnType<typeof createGroups>
  sampling?: SamplingGroups
  frontLight?: ReturnType<typeof createPassGroup>
  /** What the samples phase of this image left for its traces phase. */
  held?: { r: Resources; current: GPUBuffer; history: GPUBuffer; frame: number }
  resources?: Resources
  turn: number
  lastImage: number
  lastGeometryKey: string
}

/** The state of a view, made at its first image. */
const newState = (k: Kit): SampledKitState => ({
  groups: createGroups(k.device, k.layouts),
  turn: 0,
  lastImage: -2,
  lastGeometryKey: '',
})

/** The view's groups over the family, made again (the old ones let go) when the family changed. */
function samplingGroupsOf(k: Kit, state: SampledKitState, family: SamplingFamily): SamplingGroups {
  if (state.sampling?.family === family) return state.sampling
  releaseSamplingGroups(state)
  const groupsOf = (layouts: Map<TileClass, GPUBindGroupLayout>) =>
    new Map(
      [...layouts].map(([tileClass, layout]) => [tileClass, createPassGroup(k.device, layout)]),
    )
  return (state.sampling = {
    family,
    sample: groupsOf(family.layouts),
    shade: groupsOf(family.shadingLayouts),
  })
}

function releaseSamplingGroups({ sampling }: SampledKitState) {
  sampling?.sample.forEach((group) => group.release())
  sampling?.shade.forEach((group) => group.release())
}

/** What the passes of an image share: the pass, what the image reads and the kit's pipelines and groups. */
interface EncodeContext {
  device: GPUDevice
  pass: GPUComputePassEncoder
  run: (made: Stage, group: GPUBindGroup, x: number, y?: number) => void
  inputs: SampledLightsInputs
  key: ContractKey
  g: SampledGeometry
  r: Resources
  current: GPUBuffer
  history: GPUBuffer
  /** Whether the tiles' hashes are joined with their neighbours' (`hashFilterOn`): the hash pass then writes the raw hash, else the guide itself. */
  hashFilter: boolean
  colours: GPUTextureView
  words: GPUTextureView
  vectors: GPUTextureView
  family: SamplingFamily
  /** The view's groups over the family. */
  sampling: SamplingGroups
  mapTrace: boolean
  /** The spatial filter that writes the debug views' values, none while no view asks. */
  spatialDebug: Stage
  stages: Kit['stages']
  groups: SampledKitState['groups']
}

/** The pixel's layers and the lights, as the groups of the sampling, the shading and the spatial filter name them. */
const pixelKeys = (c: EncodeContext) => {
  const { inputs, colours, words } = c
  return [colours, inputs.surface.views()[2], words, inputs.depth, inputs.view, inputs.lights]
}
const pixelEntries = (c: EncodeContext): GPUBindGroupEntry[] => {
  const { inputs, colours, words } = c
  return [
    { binding: D.colours, resource: colours },
    { binding: D.emissiveAo, resource: inputs.surface.views()[2] },
    { binding: D.words, resource: words },
    { binding: D.depth, resource: inputs.depth },
    { binding: D.view, resource: { buffer: inputs.view } },
    { binding: D.lights, resource: { buffer: inputs.lights } },
  ]
}

/** The light grid, the suns' ranks, the light functions and, where the key has them, the light profiles: what the sampling and the shading read. */
const lightGridKeys = (c: EncodeContext) => {
  const { inputs } = c
  return [
    inputs.tiles,
    inputs.sunRanks,
    inputs.toonTables,
    inputs.lightFunction,
    inputs.lightProfile?.view,
    inputs.lightProfile?.rectView,
  ]
}
const lightGridEntries = (c: EncodeContext): GPUBindGroupEntry[] => {
  const { inputs, key } = c
  return [
    { binding: D.tiles, resource: { buffer: inputs.tiles } },
    { binding: D.sunRanks, resource: { buffer: inputs.sunRanks } },
    { binding: D.toonTables, resource: { buffer: inputs.toonTables } },
    { binding: D.lightFunctionAtlas, resource: inputs.lightFunction },
    ...(!key.profileless && inputs.lightProfile
      ? [
          { binding: D.lightProfileAtlas, resource: inputs.lightProfile.view },
          { binding: D.lightProfileSampler, resource: inputs.lightProfile.sampler },
          { binding: D.rectAtlas, resource: inputs.lightProfile.rectView },
          { binding: D.rectAtlasSampler, resource: inputs.lightProfile.rectSampler },
        ]
      : []),
  ]
}

/** The thin and lobe targets the class reads. */
const classTargetEntries = (c: EncodeContext, tileClass: TileClass): GPUBindGroupEntry[] => {
  const { surface } = c.inputs
  return [
    ...(CLASS_CUTS[tileClass].thin
      ? [{ binding: D.subsurface, resource: surface.subsurfaceView }]
      : []),
    ...(CLASS_CUTS[tileClass].lobes ? [{ binding: D.lobes, resource: surface.lobesView }] : []),
  ]
}

/** The parameters, the samples and rays, and the compaction by kind: what every trace reads of the rays. */
const rayKeys = (r: Resources) => [
  r.params,
  r.samplesView,
  r.raysView,
  r.compactData,
  r.compactCount,
]
const rayEntries = (r: Resources): GPUBindGroupEntry[] => [
  { binding: B.params, resource: { buffer: r.params } },
  { binding: B.samples, resource: r.samplesView },
  { binding: B.rays, resource: r.raysView },
  { binding: B.compactData, resource: { buffer: r.compactData } },
  { binding: B.compactCount, resource: { buffer: r.compactCount } },
]

/** The compaction of the rays by their kind, shared by the traces. */
type Compaction = ReturnType<typeof compactionOf>

/** The compaction of the rays by their kind: the groups, and the lists' width. */
function compactionOf(c: EncodeContext) {
  const { inputs, g, r } = c
  const { groups } = c
  const compactGroup = groups.compact.get(
    [r.params, r.raysView, r.samplesView, inputs.lights, r.compactData, r.compactCount],
    () => [
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.rays, resource: r.raysView },
      { binding: B.samples, resource: r.samplesView },
      { binding: D.lights, resource: { buffer: inputs.lights } },
      { binding: B.compactData, resource: { buffer: r.compactData } },
      { binding: B.compactCount, resource: { buffer: r.compactCount } },
    ],
  )
  const argsOver = [0, 1, 2].map((slot) =>
    groups.compactArgs[slot]!.get([r.compactCount, r.compactArgs], () => [
      { binding: B.compactCount, resource: { buffer: r.compactCount } },
      { binding: B.compactArgs, resource: { buffer: r.compactArgs } },
    ]),
  )
  const lists = ceilDiv(g.sampleView[0], SAMPLED_GROUP)
  return { lists, compactGroup, argsOver }
}

/** The tiles of the surfaces by mode, their lists and arguments, and the samples cleared where no light is drawn. */
function encodeTiles(c: EncodeContext) {
  const { pass, run, inputs, g, r, words } = c
  const { fixed, clears } = c.stages
  const { groups } = c
  const bitmaskGroup = groups.bitmask.get(
    [words, inputs.depth, inputs.view, inputs.lights, inputs.tiles, r.bitmaskView],
    () => [
      { binding: D.words, resource: words },
      { binding: D.depth, resource: inputs.depth },
      { binding: D.view, resource: { buffer: inputs.view } },
      { binding: D.lights, resource: { buffer: inputs.lights } },
      { binding: D.tiles, resource: { buffer: inputs.tiles } },
      { binding: B.tileBitmask, resource: r.bitmaskView },
    ],
  )
  const listed = inputs.frontTiles && c.stages.frontTiles
  if (listed) encodeFrontTiles(c, inputs.frontTiles!, listed)
  else run(fixed.bitmask, bitmaskGroup, g.tiles[0], g.tiles[1])
  const listGroup = (kind: 'listView' | 'listDown', allocator: GPUBuffer, data: GPUBuffer) =>
    groups[kind].get([r.params, r.bitmaskView, allocator, data], () => [
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.tileBitmask, resource: r.bitmaskView },
      { binding: B.tileAllocator, resource: { buffer: allocator } },
      { binding: B.tileData, resource: { buffer: data } },
    ])
  run(
    fixed.listView,
    listGroup('listView', r.allocator, r.data),
    ceilDiv(g.tiles[0], SAMPLED_GROUP),
    ceilDiv(g.tiles[1], SAMPLED_GROUP),
  )
  run(
    fixed.listDown,
    listGroup('listDown', r.downAllocator, r.downData),
    ceilDiv(g.downsampledTiles[0], SAMPLED_GROUP),
    ceilDiv(g.downsampledTiles[1], SAMPLED_GROUP),
  )
  const argsGroup = (kind: 'argsView' | 'argsDown', allocator: GPUBuffer, args: GPUBuffer) =>
    groups[kind].get([allocator, args], () => [
      { binding: B.tileAllocator, resource: { buffer: allocator } },
      { binding: B.tileArgs, resource: { buffer: args } },
    ])
  run(fixed.args, argsGroup('argsView', r.allocator, r.args), 1)
  run(fixed.args, argsGroup('argsDown', r.downAllocator, r.downArgs), 1)
  const clearGroup = groups.clear.get(
    [r.params, r.downAllocator, r.downData, r.samplesView, r.raysView],
    () => downSampleEntries(r),
  )
  pass.setPipeline(clears.get()!)
  pass.setBindGroup(0, clearGroup)
  pass.dispatchWorkgroupsIndirect(r.downArgs, tileArgsAt(SAMPLED_TILE.empty))
}

/** The bits of the tiles the front layer's pass marked (`FrontTiles`), the others read as empty: the list of the marked tiles is built (the bits cleared), then the dispatch of the bits is indirect over it. */
function encodeFrontTiles(
  c: EncodeContext,
  tiles: FrontTiles,
  stages: NonNullable<EncodeContext['stages']['frontTiles']>,
) {
  const { pass, run, inputs, g, r, words, groups } = c
  const listGroup = groups.frontList.get(
    [r.params, tiles.maskView, r.bitmaskView, tiles.allocator, tiles.data],
    () => [
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.frontMask, resource: tiles.maskView },
      { binding: B.tileBitmask, resource: r.bitmaskView },
      { binding: B.tileAllocator, resource: { buffer: tiles.allocator } },
      { binding: B.tileData, resource: { buffer: tiles.data } },
    ],
  )
  run(
    stages.list,
    listGroup,
    ceilDiv(g.tiles[0], SAMPLED_GROUP),
    ceilDiv(g.tiles[1], SAMPLED_GROUP),
  )
  const argsGroup = groups.frontArgs.get([tiles.allocator, tiles.args], () => [
    { binding: B.tileAllocator, resource: { buffer: tiles.allocator } },
    { binding: B.tileArgs, resource: { buffer: tiles.args } },
  ])
  run(stages.args, argsGroup, 1)
  const bitsGroup = groups.bitmaskListed.get(
    [
      words,
      inputs.depth,
      inputs.view,
      inputs.lights,
      inputs.tiles,
      r.bitmaskView,
      tiles.allocator,
      tiles.data,
    ],
    () => [
      { binding: D.words, resource: words },
      { binding: D.depth, resource: inputs.depth },
      { binding: D.view, resource: { buffer: inputs.view } },
      { binding: D.lights, resource: { buffer: inputs.lights } },
      { binding: D.tiles, resource: { buffer: inputs.tiles } },
      { binding: B.tileBitmask, resource: r.bitmaskView },
      { binding: B.tileAllocator, resource: { buffer: tiles.allocator } },
      { binding: B.tileData, resource: { buffer: tiles.data } },
    ],
  )
  pass.setPipeline(stages.bitmask.get()!)
  pass.setBindGroup(0, bitsGroup)
  pass.dispatchWorkgroupsIndirect(tiles.args, 0)
}

/** The bindings of the uniform and the draw's lists of tiles, then the samples and rays it writes. */
function downSampleEntries(r: Resources): GPUBindGroupEntry[] {
  return [
    { binding: B.params, resource: { buffer: r.params } },
    { binding: B.downAllocator, resource: { buffer: r.downAllocator } },
    { binding: B.downData, resource: { buffer: r.downData } },
    { binding: B.samples, resource: r.samplesView },
    { binding: B.rays, resource: r.raysView },
  ]
}

/** The bindings of the filtered light: what the temporal pass writes and the spatial pass reads. */
function filteredEntries(views: {
  diffuse: GPUTextureView
  specular: GPUTextureView
  moments: GPUTextureView
  frames: GPUTextureView
}): GPUBindGroupEntry[] {
  return [
    { binding: B.filteredDiffuse, resource: views.diffuse },
    { binding: B.filteredSpecular, resource: views.specular },
    { binding: B.filteredMoments, resource: views.moments },
    { binding: B.filteredFrames, resource: views.frames },
  ]
}

/** The draw of the lights of each tile, by mode. */
function encodeDraws(c: EncodeContext) {
  const { pass, inputs, r, history, vectors, family, sampling } = c
  for (const { mode, tileClass } of SAMPLING_MODES) {
    const sampleGroup = sampling.sample
      .get(tileClass)!
      .get(
        [
          ...pixelKeys(c),
          ...lightGridKeys(c),
          r.params,
          r.downAllocator,
          r.downData,
          r.samplesView,
          r.raysView,
          history,
          inputs.noise,
          vectors,
          inputs.surface.subsurfaceView,
          inputs.surface.lobesView,
        ],
        () => [
          ...pixelEntries(c),
          ...lightGridEntries(c),
          ...downSampleEntries(r),
          { binding: B.guideHistory, resource: { buffer: history } },
          { binding: B.blue, resource: inputs.noise },
          { binding: B.vectors, resource: vectors },
          ...classTargetEntries(c, tileClass),
        ],
      )
    pass.setPipeline(family.stages.get(mode)!.get()!)
    pass.setBindGroup(0, sampleGroup)
    pass.dispatchWorkgroupsIndirect(r.downArgs, tileArgsAt(mode))
  }
}

/** The lights the maps shadow, traced through them before the screen's trace takes the rays that remain. */
function traceMaps(c: EncodeContext, t: Compaction) {
  const { pass, run, inputs, g, r, colours } = c
  const { vsmStages, compacts } = c.stages
  const { groups } = c
  const { lists, compactGroup, argsOver } = t
  // The lights the maps shadow are traced through them, before the screen's trace takes the rays that remain.
  const m = inputs.vsm!
  run(compacts[2]!.list, compactGroup, lists, ceilDiv(g.sampleView[1], SAMPLED_GROUP))
  run(compacts[2]!.args, argsOver[2]!, 1)
  const mapGroup = groups.vsm.get(
    [
      colours,
      inputs.lights,
      m.uniforms,
      m.pageTable,
      m.projectionData,
      m.pool,
      m.view,
      inputs.noise,
      ...rayKeys(r),
    ],
    () => [
      { binding: D.colours, resource: colours },
      { binding: D.lights, resource: { buffer: inputs.lights } },
      { binding: VSM_TRACE_BINDING.uniforms, resource: { buffer: m.uniforms } },
      { binding: VSM_TRACE_BINDING.pageTable, resource: { buffer: m.pageTable } },
      { binding: VSM_TRACE_BINDING.projectionData, resource: { buffer: m.projectionData } },
      { binding: VSM_TRACE_BINDING.pool, resource: { buffer: m.pool } },
      { binding: VSM_TRACE_BINDING.view, resource: { buffer: m.view } },
      { binding: VSM_TRACE_BINDING.noise, resource: inputs.noise },
      ...rayEntries(r),
    ],
  )
  pass.setPipeline(vsmStages[inputs.classicShadows ? 1 : 0]!.get()!)
  pass.setBindGroup(0, mapGroup)
  pass.setBindGroup(1, inputs.reflection)
  pass.dispatchWorkgroupsIndirect(r.compactArgs, compactArgsAt(2))
}

/** The rays of the surfaces traced through the screen. */
function traceScreen(c: EncodeContext, t: Compaction) {
  const { pass, run, inputs, g, r, colours, words } = c
  const { traceStage, compacts } = c.stages
  const { groups } = c
  const { lists, compactGroup, argsOver } = t
  run(compacts[0]!.list, compactGroup, lists, ceilDiv(g.sampleView[1], SAMPLED_GROUP))
  run(compacts[0]!.args, argsOver[0]!, 1)
  const traceGroup = groups.trace.get([colours, words, ...rayKeys(r)], () => [
    { binding: D.colours, resource: colours },
    { binding: D.words, resource: words },
    ...rayEntries(r),
  ])
  pass.setPipeline(traceStage.get()!)
  pass.setBindGroup(0, traceGroup)
  pass.setBindGroup(1, inputs.reflection)
  pass.dispatchWorkgroupsIndirect(r.compactArgs, compactArgsAt(0))
}

/** What the screen left goes on through the distance field, and what that left visible through the strands' voxels. */
function traceField(c: EncodeContext, t: Compaction, field: GlobalFieldRead) {
  const { pass, run, inputs, g, r, device } = c
  const { softwareStage, hairTrace, compacts, hairTraceSettings } = c.stages
  const { groups } = c
  const { lists, compactGroup, argsOver } = t
  // What the screen left goes on through the distance field.
  run(compacts[1]!.list, compactGroup, lists, ceilDiv(g.sampleView[1], SAMPLED_GROUP))
  run(compacts[1]!.args, argsOver[1]!, 1)
  const softwareGroup = groups.software.get(
    [inputs.lights, ...rayKeys(r), field.readGeneration],
    () => [
      { binding: D.lights, resource: { buffer: inputs.lights } },
      ...rayEntries(r),
      ...field.readEntries(SOFTWARE_FIELD_BINDING),
    ],
  )
  pass.setPipeline(softwareStage.get()!)
  pass.setBindGroup(0, softwareGroup)
  pass.setBindGroup(1, inputs.reflection)
  pass.dispatchWorkgroupsIndirect(r.compactArgs, compactArgsAt(1))
  if (inputs.hairVoxels) {
    // What the distance field left visible is marched through the strands' voxels.
    const { set, settings: voxel } = inputs.hairVoxels
    device.queue.writeBuffer(
      hairTraceSettings,
      0,
      new Float32Array([
        voxel.densityScaleShadow,
        0,
        voxel.steppingScaleShadow,
        HAIR_SURFACE_OCCLUSION,
      ]),
    )
    const hairGroup = groups.hairTrace.get(
      [
        inputs.lights,
        set.paramsBuffer,
        set.nodes,
        set.pageIndex,
        set.voxels,
        hairTraceSettings,
        ...rayKeys(r),
      ],
      () => [
        { binding: D.lights, resource: { buffer: inputs.lights } },
        { binding: 0, resource: { buffer: set.paramsBuffer } },
        { binding: 1, resource: { buffer: set.nodes } },
        { binding: 2, resource: { buffer: set.pageIndex } },
        { binding: 3, resource: { buffer: set.voxels } },
        { binding: HAIR_SURFACE_TRACE_SETTINGS, resource: { buffer: hairTraceSettings } },
        ...rayEntries(r),
      ],
    )
    pass.setPipeline(hairTrace().get()!)
    pass.setBindGroup(0, hairGroup)
    pass.setBindGroup(1, inputs.reflection)
    pass.dispatchWorkgroupsIndirect(r.compactArgs, compactArgsAt(1))
  }
}

/** The hash of what each tile saw, then every pixel of the tiles of each mode lit by the lights its samples drew, resolved for the filters. */
function encodeShading(c: EncodeContext) {
  const { pass, run, inputs, g, r, current, family, hashFilter } = c
  const { fixed, clearResolved } = c.stages
  const { groups } = c
  const hashTarget = hashFilter ? r.hashRaw : current
  const hashGroup = groups.hash.get([r.params, r.samplesView, hashTarget], () => [
    { binding: B.params, resource: { buffer: r.params } },
    { binding: B.samples, resource: r.samplesView },
    { binding: B.hashRaw, resource: { buffer: hashTarget } },
  ])
  run(fixed.hash, hashGroup, g.tiles[0], g.tiles[1])
  if (hashFilter) {
    const filterGroup = groups.filterHash.get([r.params, r.hashRaw, current], () => [
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.hashRaw, resource: { buffer: r.hashRaw } },
      { binding: B.guideCurrent, resource: { buffer: current } },
    ])
    run(
      fixed.filterHash,
      filterGroup,
      ceilDiv(g.tiles[0], SAMPLED_GROUP),
      ceilDiv(g.tiles[1], SAMPLED_GROUP),
    )
  }
  // The empty tiles, which the shading below never visits, are marked invalid so they do not keep the last image's light.
  const clearResolvedGroup = groups.clearResolved.get(
    [r.params, r.allocator, r.data, r.resolvedDiffuseView, r.resolvedSpecularView],
    () => [
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.tileAllocator, resource: { buffer: r.allocator } },
      { binding: B.tileData, resource: { buffer: r.data } },
      { binding: B.resolvedDiffuse, resource: r.resolvedDiffuseView },
      { binding: B.resolvedSpecular, resource: r.resolvedSpecularView },
    ],
  )
  pass.setPipeline(clearResolved.get()!)
  pass.setBindGroup(0, clearResolvedGroup)
  pass.dispatchWorkgroupsIndirect(r.args, tileArgsAt(SAMPLED_TILE.empty))
  // Every pixel of the tiles of each mode, lit by the lights its samples drew, resolved for the filters.
  for (const { mode, tileClass } of SAMPLING_MODES) {
    const shadeGroup = c.sampling.shade
      .get(tileClass)!
      .get(
        [
          ...pixelKeys(c),
          ...lightGridKeys(c),
          r.params,
          r.allocator,
          r.data,
          r.samplesView,
          r.resolvedDiffuseView,
          r.resolvedSpecularView,
          inputs.noise,
          inputs.surface.subsurfaceView,
          inputs.surface.lobesView,
        ],
        () => [
          ...pixelEntries(c),
          ...lightGridEntries(c),
          { binding: B.params, resource: { buffer: r.params } },
          { binding: B.tileAllocator, resource: { buffer: r.allocator } },
          { binding: B.tileData, resource: { buffer: r.data } },
          { binding: B.samples, resource: r.samplesView },
          { binding: B.resolvedDiffuse, resource: r.resolvedDiffuseView },
          { binding: B.resolvedSpecular, resource: r.resolvedSpecularView },
          { binding: B.blue, resource: inputs.noise },
          ...classTargetEntries(c, tileClass),
        ],
      )
    pass.setPipeline(family.shading.get(mode)!.get()!)
    pass.setBindGroup(0, shadeGroup)
    pass.dispatchWorkgroupsIndirect(r.args, tileArgsAt(mode))
  }
}

/** The resolved light blended with the history of the image before, then filtered over the neighbours. */
function encodeDenoise(c: EncodeContext) {
  const { pass, inputs, g, r, current, colours, words, vectors } = c
  const { temporalStage, spatialStage, historySampler } = c.stages
  const { groups } = c
  // The resolved light blended with the history of the image before (the sets take turns with the guides).
  const turnOf = r.guides.indexOf(current)
  const written = r.histories[turnOf]!
  const read = r.histories[turnOf ^ 1]!
  const temporalGroup = groups.temporal.get(
    [
      colours,
      words,
      r.params,
      r.resolvedDiffuseView,
      r.resolvedSpecularView,
      read.views.diffuse,
      read.views.specular,
      read.views.moments,
      read.views.frames,
      written.views.diffuse,
      written.views.specular,
      written.views.moments,
      written.views.frames,
      read.exposure,
      written.exposure,
      vectors,
    ],
    () => [
      { binding: D.colours, resource: colours },
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.resolvedDiffuse, resource: r.resolvedDiffuseView },
      { binding: B.resolvedSpecular, resource: r.resolvedSpecularView },
      { binding: B.historyDiffuse, resource: read.views.diffuse },
      { binding: B.historySpecular, resource: read.views.specular },
      { binding: B.historyMoments, resource: read.views.moments },
      { binding: B.historyFrames, resource: read.views.frames },
      ...filteredEntries(written.views),
      { binding: B.historySampler, resource: historySampler },
      { binding: B.exposureBefore, resource: { buffer: read.exposure } },
      { binding: B.exposureNow, resource: { buffer: written.exposure } },
      { binding: B.vectors, resource: vectors },
    ],
  )
  pass.setPipeline(temporalStage.get()!)
  pass.setBindGroup(0, temporalGroup)
  pass.setBindGroup(1, inputs.reflection)
  pass.dispatchWorkgroups(ceilDiv(g.view[0], SAMPLED_GROUP), ceilDiv(g.view[1], SAMPLED_GROUP))
  // The filtered light filtered over the neighbours, its detail put back: the light to add to the lit image.
  const debugPixels = inputs.debugPixels
  const spatialGroup = (debugPixels ? groups.spatialDebug : groups.spatial).get(
    [
      ...pixelKeys(c),
      inputs.lightFunction,
      r.params,
      r.resolvedDiffuseView,
      written.views.diffuse,
      written.views.specular,
      written.views.moments,
      written.views.frames,
      r.compositeView,
      inputs.surface.subsurfaceView,
      inputs.surface.lobesView,
      debugPixels,
    ],
    () => [
      ...pixelEntries(c),
      { binding: D.lightFunctionAtlas, resource: inputs.lightFunction },
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.resolvedDiffuse, resource: r.resolvedDiffuseView },
      ...filteredEntries(written.views),
      { binding: B.composite, resource: r.compositeView },
      { binding: D.subsurface, resource: inputs.surface.subsurfaceView },
      { binding: D.lobes, resource: inputs.surface.lobesView },
      ...(debugPixels ? [{ binding: B.debugPixels, resource: debugPixels }] : []),
    ],
  )
  pass.setPipeline((debugPixels ? c.spatialDebug : spatialStage).get()!)
  pass.setBindGroup(0, spatialGroup)
  pass.dispatchWorkgroups(ceilDiv(g.view[0], SAMPLED_GROUP), ceilDiv(g.view[1], SAMPLED_GROUP))
}

/** What the next passes read of the image. */
const samplesOf = (g: SampledGeometry, r: Resources, current: GPUBuffer): SampledSamples => ({
  geometry: g,
  samples: r.samplesView,
  rays: r.raysView,
  tileBitmask: r.bitmaskView,
  downAllocator: r.downAllocator,
  downData: r.downData,
  downArgs: r.downArgs,
  guide: current,
  params: r.params,
  resolvedDiffuse: r.resolvedDiffuseView,
  filtered: r.histories[r.guides.indexOf(current)]!.views,
  composite: r.compositeView,
  debug: {
    compactCount: r.compactCount,
    allocator: r.allocator,
    data: r.data,
    downAllocator: r.downAllocator,
    downData: r.downData,
  },
  resolvedSpecular: r.resolvedSpecularView,
})

/** A view's bind groups let go, the next image making them again. */
function releaseGroups(state: SampledKitState) {
  for (const group of Object.values(state.groups).flat()) group.release()
  releaseSamplingGroups(state)
  state.frontLight?.release()
}

/** A view's groups let go and its resources retired (never destroyed at once), the next image making them again. */
function releaseKit(k: Kit, state: SampledKitState) {
  releaseGroups(state)
  if (state.resources) retire(k.device, state.resources)
  state.resources = undefined
  state.held = undefined
}

/** The one-texel stand-in for the motion vectors of an input that has none. */
function noVectorsOf(device: GPUDevice) {
  const texture = device.createTexture({
    label: 'Trillion3D sampled no vectors',
    size: [1, 1],
    format: 'rg32uint',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  return { texture, view: texture.createView() }
}

/** The resources of the image's size and the uniform of the image written, the allocators cleared: the guide of the image before taken for the history only if that was the last one encoded. */
function prepareImage(
  k: Kit,
  state: SampledKitState,
  encoder: GPUCommandEncoder,
  inputs: SampledLightsInputs,
  g: SampledGeometry,
  geometryKey: string,
) {
  const { device } = k
  const input = inputs.input
  const settings = sampledSettingsOf(inputs.settings, input)
  // The guide holds the image before only if that was the last one encoded: after a pause, a cut or a skipped image it holds nothing to guide by.
  let historyValid = state.lastImage === inputs.image - 1
  state.lastImage = inputs.image
  if (!state.resources || geometryKey !== state.lastGeometryKey) {
    releaseKit(k, state)
    state.resources = makeResources(device, g, inputs.lightCount)
    state.lastGeometryKey = geometryKey
    historyValid = false
  }
  const { resources } = state
  state.turn ^= 1
  const held = {
    r: resources,
    current: resources.guides[state.turn]!,
    history: resources.guides[state.turn ^ 1]!,
    frame: inputs.frame,
  }
  state.held = held
  device.queue.writeBuffer(
    held.r.params,
    0,
    writeSampledParams(new ArrayBuffer(SAMPLED_PARAMS_WORDS * 4), g, settings, {
      frame: inputs.frame,
      history: historyValid,
      historyTiles: g.tiles,
      textured: false,
      previousViewProjection: inputs.previousViewProjection,
      fastClear: settings.sampledLightsFastClear,
      soft: sampledSoftShadows(inputs.settings, input),
      specularOnly:
        input === 'frontTranslucency' && inputs.settings.sampledLightsFrontLayerSpecularOnly,
      lightCount: inputs.lightCount,
    }),
  )
  encoder.clearBuffer(held.r.allocator)
  encoder.clearBuffer(held.r.downAllocator)
  encoder.clearBuffer(held.r.compactCount)
}

/** Whether the pipelines the image asks for are compiled. */
function imageReady(
  k: Kit,
  inputs: SampledLightsInputs,
  family: SamplingFamily,
  settings: SampledLightsSettings,
  tracing: boolean,
  mapTrace: boolean,
) {
  const {
    fixed,
    clears,
    traceStage,
    compacts,
    softwareStage,
    hairTrace,
    vsmStages,
    temporalStage,
    spatialStage,
  } = k.stages
  const modeStages = SAMPLING_MODES.flatMap(({ mode }) => [
    family.stages.get(mode)!,
    family.shading.get(mode)!,
  ])
  return chainReady(
    ...Object.values(fixed),
    ...(inputs.frontTiles && k.stages.frontTiles ? Object.values(k.stages.frontTiles) : []),
    clears,
    ...modeStages,
    ...(tracing
      ? [
          traceStage,
          ...compacts
            .filter((_, slot) => slot === 0 || (slot === 1 ? !!inputs.field : mapTrace))
            .flatMap((c) => [c.list, c.args]),
          ...(inputs.field ? [softwareStage, ...(inputs.hairVoxels ? [hairTrace()] : [])] : []),
          ...(mapTrace ? [vsmStages[inputs.classicShadows ? 1 : 0]!] : []),
          temporalStage,
          spatialStage,
          ...(inputs.debugPixels ? [k.spatialDebug()] : []),
        ]
      : []),
  )
}

/** What the light complexity view reads of the image: the sampling's own weighing layout, the guide, the noise and the vectors, and the pixel's layers and the light grid the cost reads. */
function complexityImage(c: EncodeContext): ComplexityImage {
  const { inputs, key, r, history, vectors, words } = c
  const surface = inputs.surface
  return {
    key,
    front: inputs.input === 'frontTranslucency',
    textured: inputs.texturedRects,
    layoutEntries: [
      ...weighingLayoutEntries(key),
      ...guideLayoutEntries(),
      ...classTargetLayoutEntries(TILE_CLASS.complex),
    ],
    groupKeys: [
      ...pixelKeys(c),
      ...lightGridKeys(c),
      r.params,
      history,
      inputs.noise,
      vectors,
      surface.subsurfaceView,
      surface.lobesView,
    ],
    groupEntries: () => [
      ...pixelEntries(c),
      ...lightGridEntries(c),
      { binding: B.params, resource: { buffer: r.params } },
      { binding: B.guideHistory, resource: { buffer: history } },
      { binding: B.blue, resource: inputs.noise },
      { binding: B.vectors, resource: vectors },
      ...classTargetEntries(c, TILE_CLASS.complex),
    ],
    cost: {
      words,
      depth: inputs.depth,
      view: inputs.view,
      lights: inputs.lights,
      tiles: inputs.tiles,
      sunRanks: inputs.sunRanks,
      params: r.params,
      size: c.g.view,
    },
  }
}

/**
 * Encodes the first lot of passes of an image (`SampledLightsInputs`) into `encoder`, or nothing while a pipeline compiles.
 * Returns what the next passes read.
 */
function encodeImage(
  k: Kit,
  encoder: GPUCommandEncoder,
  state: SampledKitState,
  inputs: SampledLightsInputs,
  phase: SampledPhase,
): SampledSamples | undefined {
  const { device } = k
  const input = inputs.input
  const settings = sampledSettingsOf(inputs.settings, input)
  const { key } = inputs
  if (!key.profileless && !inputs.lightProfile) throw new Error('SAMPLED_LIGHT_PROFILE_MISSING')
  const g = sampledGeometry(
    inputs.width,
    inputs.height,
    sampledDownsampleFactor(settings, input),
    sampledSamplesForInput(settings, input),
  )
  const geometryKey = `${g.view}|${g.downsample}|${g.samplesPerPixel}|${inputs.lightCount}`
  const family = k.cache.samplingFor(key, inputs.texturedRects, state.sampling?.family)
  // The screen trace gates itself on its setting (the uniform); the software trace needs the field.
  const tracing = !!inputs.reflection
  const mapTrace =
    tracing && !!inputs.vsm && settings.sampledLightsShadowMethod === 'virtualShadowMap'
  if (!imageReady(k, inputs, family, settings, tracing, mapTrace)) return undefined
  if (phase === 'traces' && (!state.held || state.held.frame !== inputs.frame)) return undefined
  if (phase !== 'traces') prepareImage(k, state, encoder, inputs, g, geometryKey)
  const { r, current, history } = state.held!
  const [colours, words] = inputs.surface.stores()
  const vectors = inputs.vectors ?? (k.noVectors ??= noVectorsOf(device)).view
  // The change of each light's power (`lightPower.ts`), into the ratios the draw reads in the guide of the image before, and the ranks the lights had in the image before, the second half of the same buffer: the live lights' words only.
  if (phase !== 'traces') {
    const live = Math.min(inputs.liveLights, inputs.lightCount) * 4
    encoder.copyBufferToBuffer(inputs.power, 0, history, guideAt(g).ratios * 4, live)
    encoder.copyBufferToBuffer(
      inputs.power,
      inputs.power.size / 2,
      history,
      ranksAt(g, inputs.lightCount) * 4,
      live,
    )
  }
  const pass = encoder.beginComputePass(PASS)
  const run = (made: Stage, group: GPUBindGroup, x: number, y = 1) => {
    pass.setPipeline(made.get()!)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(Math.max(1, x), Math.max(1, y))
  }
  const c: EncodeContext = {
    device,
    pass,
    run,
    inputs,
    key,
    g,
    r,
    current,
    history,
    hashFilter: hashFilterOn(settings),
    colours,
    words,
    vectors,
    family,
    sampling: samplingGroupsOf(k, state, family),
    mapTrace,
    spatialDebug: inputs.debugPixels ? k.spatialDebug() : k.stages.spatialStage,
    stages: k.stages,
    groups: state.groups,
  }
  if (phase !== 'traces') {
    encodeTiles(c)
    encodeDraws(c)
    if (inputs.complexity) k.complexity().encode(pass, complexityImage(c), inputs.complexity)
  }
  if (phase !== 'samples') {
    if (tracing) {
      const t = compactionOf(c)
      if (mapTrace) traceMaps(c, t)
      traceScreen(c, t)
      if (inputs.field) traceField(c, t, inputs.field)
    }
    encodeShading(c)
    if (inputs.reflection) encodeDenoise(c)
  }
  pass.end()
  return samplesOf(g, r, current)
}

/**
 * The sampled lighting's first lot of passes for a device: the pipelines (asked off the frame, the sampling's by key) and the resources of the
 * size of the last image. `failed` hears a compile that failed.
 */
export function createSampledLights(
  device: GPUDevice,
  failed: (error: unknown) => void,
  front = false,
) {
  const layouts = makeLayouts(device)
  const stage: StageMaker = (layout, module, entry, label, constants) => {
    const made = preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      entry,
      constants,
      label,
    ).ask()
    made.prepare().catch(failed)
    return made
  }
  const frontLight = createFrontLight(device, stage)
  let spatialDebug: Stage | undefined
  let complexity: ReturnType<typeof createLightComplexity> | undefined
  const kit: Kit = {
    device,
    complexity: () => (complexity ??= createLightComplexity(device, failed)),
    spatialDebug: () =>
      (spatialDebug ??= askedComputeStage(
        device,
        [layouts.spatialDebug],
        spatialWgsl(true),
        SPATIAL_ENTRY,
        'Trillion3D sampled spatial filter debug',
        failed,
      )),
    stages: {
      ...createTileStages(device, layouts, stage, front),
      ...createTraceStages(device, failed, layouts, stage),
      ...createFilterStages(device, failed, layouts),
    },
    layouts,
    frontLightLayout: frontLight.layout,
    cache: createSamplingCache(device, stage, front),
  }
  return {
    /** The state of a view, made at its first image; the view's record frees it with `release`. */
    newState: () => newState(kit),
    encode: (
      state: SampledKitState,
      encoder: GPUCommandEncoder,
      inputs: SampledLightsInputs,
      phase: SampledPhase = 'all',
    ) => encodeImage(kit, encoder, state, inputs, phase),
    /** Copies the layer's light to where the blend reads it, through the group of the view's `state`. */
    packFrontLight(
      state: SampledKitState,
      encoder: GPUCommandEncoder,
      composite: GPUTextureView,
      words: GPUTextureView,
      traced: GPUTextureView,
      size: readonly [number, number],
      mark?: number,
    ) {
      state.frontLight ??= createPassGroup(device, kit.frontLightLayout)
      return frontLight.pack(state.frontLight, encoder, composite, words, traced, size, mark)
    },
    /** Counts image `image` of the device (once, whatever the number of views that encode it): the sampling families nobody asked for during a while are let go. */
    tick: () => kit.cache.tick(),
    /** Frees a view's kit state when the sampled lighting is off for it (the next image that turns it on makes it again). */
    release: (state: SampledKitState) => releaseKit(kit, state),
    dispose() {
      complexity?.dispose()
      kit.stages.hairTraceSettings.destroy()
      if (kit.noVectors) retire(device, kit.noVectors.texture)
      kit.noVectors = undefined
    },
  }
}
