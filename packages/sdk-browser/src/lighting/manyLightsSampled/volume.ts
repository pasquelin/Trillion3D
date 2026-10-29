/**
 * THE SAMPLED LIGHTING'S VOLUMES, their resources (`volumeWgsl.ts` draws into them, the fog's scatter and the translucency volume's injection read them). Two domains: the fog's froxel grid (the
 * pixels of a voxel, the depth slices and their law are `sampledLightsVolumeGridPixelSize`, `…GridSizeZ`, `…DepthDistributionScale`), which the translucency volume shares where
 * `sampledLightsVolumeUnified` holds; and, where it does not, the translucency volume's own cells (its two cascades stacked, `sampledLightsTranslucencyVolume*`). Each holds the samples of its
 * downsampled voxels, the sets of the lights each tile of voxels drew in this image and in the one before (the guide of the next draw) and its uniform. A grid is remade when the view or the settings
 * change, and its history is dropped with it, with a camera cut or a skipped image.
 */
import { halton } from '../../../../math/src/sequence/halton.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { writeClipDepth } from '../../gpu/core/selectionProjection.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { sliceParams } from '../fog/layout.ts'
import { VOLUME_HASH_TILE, VOLUME_HASH_WORDS, VOLUME_PARAMS_WORDS } from './volumeWgsl.ts'
import {
  sampledMinSampleWeightEstimate,
  sampledSamplesPerVoxel3d,
  sampledVolumeDownsampleFactor,
  type SampledLightsSettings,
} from './parameters.ts'
import { directionalRatio } from './paramsWgsl.ts'

/** What the passes bind and the readers read of a volume. */
export interface SampledVolumeBinding {
  params: GPUBuffer
  samplesWrite: GPUTextureView
  samplesRead: GPUTextureView
  /** The marks of the samples whose ray is to be traced, the list of those samples, its length and the arguments of the dispatch over it (`volumeTraceWgsl.ts`). */
  rays: GPUTextureView
  compactData: GPUBuffer
  compactCount: GPUBuffer
  compactArgs: GPUBuffer
  /** The samples' texture size along each axis. */
  sampleSize: readonly [number, number, number]
  hashHistory: GPUBuffer
  hashCurrent: GPUBuffer
  ratios: GPUBuffer
  /** The voxels of the downsampled grid along each axis, and the tiles of the hash. */
  downSize: readonly [number, number, number]
  hashTiles: readonly [number, number, number]
  /** The image this binding was prepared for, and the last image whose pass drew the samples (set by the pass): a reader uses the samples only of the same image. */
  image: number
  drawn: number
}

/** What an image gives the volumes: the settings, the camera the fog's grid is placed by and what the draw is guided by. */
export interface SampledVolumeImage {
  settings: SampledLightsSettings
  /** The pixels of the view, the camera's near plane and the volume's far end, in metres (the fog's grid). */
  width: number
  height: number
  near: number
  far: number
  /** The image's number, its frame index for the jitter, whether the camera cut the history, the view-projection of the image before (zeros for none). */
  image: number
  frame: number
  cut: boolean
  previousViewProjection: ArrayLike<number>
  /** The buffer of the lights' power ratios, none while they are not measured. */
  ratios?: GPUBuffer
  /** The camera the grid is placed by (`mlp`): its eye and forward, its view-projection and the inverse, its projection (the depth buffer's map to a view depth), the pre-exposure. */
  camera: {
    eye: ArrayLike<number>
    forward: ArrayLike<number>
    viewProj: ArrayLike<number>
    inverseViewProj: ArrayLike<number>
    projection: ArrayLike<number>
    perspective: boolean
  }
  preExposure: number
  /** The fog's phase function anisotropy, the sun's rank in the light buffer (-1 none) and the columns and rows of the light grid. */
  anisotropy: number
  /** The fog's scale of the inverse square's bias per cell radius (`volumetricFogLampSoftening`). */
  lampSoftening: number
  sunRank: number
  lightCells: readonly [number, number]
}

/** The translucency volume's own cells (the domain where it does not share the fog's samples): `dim` cells a side, its two cascades' boxes. */
export interface SampledTranslucencyImage extends Omit<
  SampledVolumeImage,
  'width' | 'height' | 'near' | 'far' | 'anisotropy' | 'lampSoftening'
> {
  dim: number
  /** For each cascade, the corner of its box and the size of a cell. */
  cascades: readonly [
    { corner: ArrayLike<number>; cell: number },
    { corner: ArrayLike<number>; cell: number },
  ]
  width: number
  height: number
}

/** The depth buffer's map to a view depth, rewritten each image. */
const depthMap: [number, number] = [0, 0]
const ceil3 = (v: readonly [number, number, number], by: readonly [number, number, number]) =>
  [ceilDiv(v[0], by[0]), ceilDiv(v[1], by[1]), ceilDiv(v[2], by[2])] as const

/** What differs between the two domains once the settings are read: the grid, its downsample, its samples, the weights and the place a voxel's samples are taken at. */
interface DomainShape {
  grid: readonly [number, number, number]
  pixel: number
  shift: number
  per: readonly [number, number, number]
  law: { b: number; o: number; s: number }
  minWeight: number
  guide: boolean
  worldTraces: boolean
  culled: boolean
  jitter: readonly [number, number, number]
  anisotropy: number
  biasScale: number
}

/** The samples' texture and the two sets of hashes of a grid. */
function createGridResources(
  device: GPUDevice,
  key: string,
  shape: DomainShape,
  down: readonly [number, number, number],
  tiles: readonly [number, number, number],
) {
  const sampleSize = [
    down[0] * shape.per[0],
    down[1] * shape.per[1],
    down[2] * shape.per[2],
  ] as const
  const storage3d = (label: string) =>
    device.createTexture({
      label,
      size: [...sampleSize],
      dimension: '3d',
      format: 'r32uint',
      usage: GPUTextureUsage.STORAGE_BINDING,
    })
  const samples = storage3d('Trillion3D sampled volume samples')
  const rays = storage3d('Trillion3D sampled volume rays')
  const storage = (label: string, size: number, usage = 0) =>
    device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | usage })
  const hashBytes = tiles[0] * tiles[1] * tiles[2] * VOLUME_HASH_WORDS * 4
  return {
    key,
    samples,
    rays,
    sampleSize,
    writeView: samples.createView({ dimension: '3d' }),
    readView: samples.createView({ dimension: '3d' }),
    raysView: rays.createView({ dimension: '3d' }),
    compactData: storage(
      'Trillion3D sampled volume trace list',
      sampleSize[0] * sampleSize[1] * sampleSize[2] * 4,
    ),
    compactCount: storage('Trillion3D sampled volume trace count', 16),
    compactArgs: storage('Trillion3D sampled volume trace args', 16, GPUBufferUsage.INDIRECT),
    hash: [0, 1].map((i) =>
      device.createBuffer({
        label: `Trillion3D sampled volume hash ${i}`,
        size: hashBytes,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    ),
  }
}
type GridResources = ReturnType<typeof createGridResources>

/** The switches and sizes of the uniform's integer words (`ML_PARAMS_WGSL`): the grid, the samples, the flags, the tiles, the domain. */
function writeWords(
  u: Uint32Array,
  input: SampledVolumeImage | SampledTranslucencyImage,
  shape: DomainShape,
  domain: number,
  down: readonly number[],
  tiles: readonly number[],
  history: boolean,
) {
  const { settings } = input
  u.set(
    [
      ...shape.grid,
      shape.pixel,
      ...down,
      shape.shift,
      ...shape.per,
      shape.per[0] * shape.per[1] * shape.per[2],
    ],
    0,
  )
  u.set(
    [
      shape.guide ? 1 : 0,
      history ? 1 : 0,
      shape.worldTraces ? 1 : 0,
      settings.sampledLightsMergeRays ? 1 : 0,
      settings.sampledLightsDirectional ? 1 : 0,
      input.frame >>> 0,
      input.ratios ? 1 : 0,
      shape.culled ? 1 : 0,
      ...tiles,
      0,
      settings.sampledLightsVolumeUnified && settings.sampledLightsTranslucencyVolume ? 1 : 0,
      domain,
      input.lightCells[0],
      input.lightCells[1],
    ],
    12,
  )
}

/** The weights and the places of the uniform's float words: the depth law, the weights, the jitter, the camera and the cascades. */
function writeFloats(
  f: Float32Array,
  input: SampledVolumeImage | SampledTranslucencyImage,
  shape: DomainShape,
  cascades: SampledTranslucencyImage['cascades'] | undefined,
) {
  const { settings, camera } = input
  f.set(
    [
      shape.law.b,
      shape.law.o,
      shape.law.s,
      1 / shape.grid[2],
      shape.minWeight,
      sampledMinSampleWeightEstimate(settings),
      settings.sampledLightsHiddenWeight,
      settings.sampledLightsHiddenWeightOnHistoryMiss,
      directionalRatio(settings.sampledLightsDirectionalFraction),
      settings.sampledLightsDirectionalMinClampWeight,
      settings.sampledLightsMaxShadingWeight,
      settings.sampledLightsMaxShadingWeightHidden,
      ...shape.jitter,
      shape.anisotropy,
      shape.biasScale,
      0,
      0,
      input.sunRank,
    ],
    28,
  )
  f.set(
    Array.from(input.previousViewProjection, (v) => Math.fround(v)),
    48,
  )
  writeClipDepth(depthMap, camera.projection)
  f.set(
    [
      camera.eye[0]!,
      camera.eye[1]!,
      camera.eye[2]!,
      1,
      camera.forward[0]!,
      camera.forward[1]!,
      camera.forward[2]!,
      0,
      input.width,
      input.height,
      camera.perspective ? 0 : 1,
      input.preExposure,
      depthMap[0],
      depthMap[1],
      0,
      0,
    ],
    64,
  )
  f.set(
    Array.from(camera.viewProj, (v) => Math.fround(v)),
    80,
  )
  f.set(
    Array.from(camera.inverseViewProj, (v) => Math.fround(v)),
    96,
  )
  cascades?.forEach(({ corner, cell }, i) =>
    f.set([corner[0]!, corner[1]!, corner[2]!, cell], 112 + i * 8),
  )
}

/** One domain's resources. */
function createDomain(device: GPUDevice, domain: 0 | 1) {
  const params = device.createBuffer({
    label: 'Trillion3D sampled volume params',
    size: VOLUME_PARAMS_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const standIn = device.createBuffer({
    label: 'Trillion3D sampled volume no ratios',
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  let made: GridResources | undefined
  let turn = 0
  let lastImage = -2
  let binding: SampledVolumeBinding | undefined
  const release = () => {
    binding = undefined
    if (!made) return
    retire(device, made.samples)
    retire(device, made.rays)
    retire(device, made.compactData)
    retire(device, made.compactCount)
    retire(device, made.compactArgs)
    for (const buffer of made.hash) retire(device, buffer)
    made = undefined
  }
  return {
    release,
    current: () => binding,
    prepare(
      input: SampledVolumeImage | SampledTranslucencyImage,
      shape: DomainShape,
      extra: { cascades?: SampledTranslucencyImage['cascades'] },
    ): SampledVolumeBinding {
      const down = ceil3(shape.grid, [1 << shape.shift, 1 << shape.shift, 1 << shape.shift])
      const tiles = ceil3(shape.grid, VOLUME_HASH_TILE)
      const key = `${shape.grid}|${shape.shift}|${shape.per}`
      let history = lastImage === input.image - 1 && !input.cut && shape.guide
      if (!made || made.key !== key) {
        release()
        made = createGridResources(device, key, shape, down, tiles)
        history = false
      }
      lastImage = input.image
      turn ^= 1
      const words = new ArrayBuffer(VOLUME_PARAMS_WORDS * 4)
      writeWords(new Uint32Array(words), input, shape, domain, down, tiles, history)
      writeFloats(new Float32Array(words), input, shape, extra.cascades)
      device.queue.writeBuffer(params, 0, words)
      binding = {
        params,
        samplesWrite: made.writeView,
        samplesRead: made.readView,
        rays: made.raysView,
        compactData: made.compactData,
        compactCount: made.compactCount,
        compactArgs: made.compactArgs,
        sampleSize: made.sampleSize,
        hashHistory: made.hash[turn ^ 1]!,
        hashCurrent: made.hash[turn]!,
        ratios: input.ratios ?? standIn,
        downSize: down,
        hashTiles: tiles,
        image: input.image,
        drawn: -1,
      }
      return binding
    },
    dispose() {
      release()
      params.destroy()
      standIn.destroy()
    },
  }
}

/** The fog grid's shape: a froxel grid on the screen's pixels, its depth law from the view's range. */
function fogShape(input: SampledVolumeImage): DomainShape {
  const { settings } = input
  const pixel = settings.sampledLightsVolumeGridPixelSize
  const grid = [
    ceilDiv(input.width, pixel),
    ceilDiv(input.height, pixel),
    settings.sampledLightsVolumeGridSizeZ,
  ] as const
  const near = Math.max(input.near, 1e-3)
  return {
    grid,
    pixel,
    shift: sampledVolumeDownsampleFactor(settings) === 2 ? 1 : 0,
    per: sampledSamplesPerVoxel3d(settings.sampledLightsVolumeSamplesPerVoxel),
    law: sliceParams(
      near,
      Math.max(input.far, near + 1e-3),
      settings.sampledLightsVolumeDepthDistributionScale,
      grid[2],
    ),
    minWeight: settings.sampledLightsVolumeMinSampleWeight,
    guide: settings.sampledLightsVolumeGuideByHistory,
    worldTraces: settings.sampledLightsVolumeWorldSpaceTraces,
    culled: settings.sampledLightsVolumeHzbOcclusionTest,
    jitter: [
      halton(input.frame & 1023, 2),
      halton(input.frame & 1023, 3),
      halton(input.frame & 1023, 5),
    ],
    anisotropy: input.anisotropy,
    biasScale: input.lampSoftening,
  }
}

/** The translucency grid's shape: the cascades' cells, no depth law, no jitter. */
function translucencyShape(input: SampledTranslucencyImage): DomainShape {
  const { settings } = input
  return {
    grid: [input.dim, input.dim, 2 * input.dim],
    pixel: 0,
    shift: settings.sampledLightsTranslucencyVolumeDownsample === 2 ? 1 : 0,
    per: sampledSamplesPerVoxel3d(settings.sampledLightsTranslucencyVolumeSamplesPerVoxel),
    law: { b: 0, o: 1, s: 1 },
    minWeight: settings.sampledLightsTranslucencyVolumeMinSampleWeight,
    guide: settings.sampledLightsTranslucencyVolumeGuideByHistory,
    worldTraces: settings.sampledLightsVolumeWorldSpaceTraces,
    culled: false,
    jitter: [0.5, 0.5, 0.5],
    anisotropy: 0,
    biasScale: 0,
  }
}

/** The sampled lighting's volumes of a device. */
export function createSampledVolume(device: GPUDevice) {
  const fog = createDomain(device, 0)
  const translucency = createDomain(device, 1)
  return {
    /** The fog's volume of this image, none where the settings leave the lights to the walk of their lists; its uniform is written now. */
    prepare(input: SampledVolumeImage): SampledVolumeBinding | undefined {
      const { settings } = input
      if (!settings.sampledLights || !settings.sampledLightsVolume) {
        fog.release()
        return undefined
      }
      return fog.prepare(input, fogShape(input), {})
    },
    /** The translucency volume's own volume of this image (where it does not share the fog's), its cells' centres the samples' places. */
    prepareTranslucency(input: SampledTranslucencyImage): SampledVolumeBinding | undefined {
      const { settings } = input
      if (
        !settings.sampledLights ||
        !settings.sampledLightsTranslucencyVolume ||
        settings.sampledLightsVolumeUnified
      ) {
        translucency.release()
        return undefined
      }
      return translucency.prepare(input, translucencyShape(input), { cascades: input.cascades })
    },
    /** The fog's volume released: the settings leave the lights to the walk of their lists. */
    releaseFog: fog.release,
    dispose() {
      fog.dispose()
      translucency.dispose()
    },
  }
}
