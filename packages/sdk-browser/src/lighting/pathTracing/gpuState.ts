import { clamp, clampLowWins } from '../../../../math/src/scalar/reals.ts'
import { ceilDiv, nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { createCachedGroup } from '../../gpu/bind/cachedGroup.ts'
import { varianceLevels } from './framePlan.ts'
import { PT_AIR_BYTES, PT_AIR_DEPTH_FORMAT } from './airMediumWgsl.ts'
import { airParameterBytes } from './airDepth.ts'
import { PT_CLOUD_BYTES, PT_CLOUD_MAP_FORMAT } from './cloudMediumWgsl.ts'
import { PT_LIGHT_TABLE_WORDS } from './lightTable.ts'
import { PT_GRID_DATA_WIDTH } from './lightGridWgsl.ts'
import { PT_LIGHT_FLOATS, PT_LIGHT_MAXIMUM } from './lightRecords.ts'
import { PT_HIT_BYTES } from './hitRecordWgsl.ts'
import { ptHitMaterialSlotBytes } from './hitMaterialWgsl.ts'
import { PT_STATE_BYTES } from './pathWgsl.ts'
import {
  PT_AOV_FORMAT,
  PT_DEPTH_FORMAT,
  PT_GRID_FORMAT,
  PT_RADIANCE_FORMAT,
  PT_VARIANCE_FORMAT,
} from './pipelines.ts'
import { createSkyTable, skyTableBytes, type SkyTable } from '../skyTable/skyTable.ts'
import { queueWords } from './queueWgsl.ts'
import { PT_STEPS, PT_VIEW_STRIDE } from './viewWgsl.ts'

/** The accumulated images of one parity of the ping-pong: a sample reads the image before's and writes this one's, and the next reverses them. */
export interface PathTracingImages {
  readonly radiance: GPUTexture
  readonly albedo: GPUTexture
  readonly normal: GPUTexture
  /** The error chain: the luminance sum, the sum of its square and the count a pixel, with its mip levels (adaptive sampling's). */
  readonly variance: GPUTexture
  /** The first level of the error chain, which the trace reads the samples a pixel has gathered from. */
  readonly varianceTop: GPUTextureView
  /** The depth of the camera's hit, as the frame stores it, the nearest of the samples. */
  readonly depth: GPUTexture
}

/** The usage of the accumulated images, read where the first view is made: no GPU global is read at load. */
const storageTexture = () =>
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST

/** The side of the tiles a view is traced in: `dispatchSize` (at least 64), less where the paths of a tile would not fit one storage binding (`PT_STATE_BYTES` each), a multiple of 8. */
export function tileSideOf(device: GPUDevice, dispatchSize: number) {
  const bytes = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
  const fit = Math.floor(Math.sqrt(bytes / PT_STATE_BYTES) / 8) * 8
  return clampLowWins(clamp(dispatchSize, 64, fit), 8, Infinity)
}

/** The tiles `size` is cut in by `side`, in the order they are traced: the first pixel and the size of each. */
export function tilesOf(size: readonly [number, number], side: number) {
  const tiles: [number, number, number, number][] = []
  for (let y = 0; y < size[1]; y += side)
    for (let x = 0; x < size[0]; x += side)
      tiles.push([x, y, Math.min(side, size[0] - x), Math.min(side, size[1] - y)])
  return tiles
}

/** The bytes of the air's optical depth table and of the two images of the clouds' acceleration map, `airSide` and `cloudSide` texels across (0 where the volume is not held); both are four 32-bit floats a texel. */
export const volumeTablesBytes = (airSide: number, cloudSide: number) =>
  (airSide * airSide + 2 * cloudSide * cloudSide) * 16

/** The bytes the held air asks of the budget: its optical depth table and the buffer of the parameters of the table's slices (nothing where the air is not held, `airSide` 0). */
export const airBytesOf = (airSide: number) =>
  volumeTablesBytes(airSide, 0) + (airSide > 0 ? airParameterBytes(airSide) : 0)

/** The bytes the path tracer asks of the device's budget for a view of `size` traced in tiles of `tile`: the accumulated images (two of each, the variance with its chain), the camera normals,
 *  the paths' states and queue, the dispatch blocks, the lights, the light grid and its lists, and the sky's tables. */
export function pathTracingBytes(
  size: readonly [number, number],
  tile: number,
  bounceLevels: number,
  blockCount: number,
  gridResolution: number,
  lightCapacity: number,
  gridCapacity: number,
  skySize: number,
  tables = 0,
  weighted = false,
) {
  const pixels = size[0] * size[1]
  const chain = Array.from(
    { length: varianceLevels(size) },
    (_, level) => (size[0] >> level || 1) * (size[1] >> level || 1),
  )
  const images =
    2 * (16 + 8 + 8 + 4) * pixels + 2 * 16 * chain.reduce((a, b) => a + b, 0) + 8 * pixels
  const paths = tile * tile
  const gridCells = gridResolution * gridResolution
  const lists =
    Math.max(1, ceilDiv(gridCapacity * 3 * gridCells, PT_GRID_DATA_WIDTH)) * PT_GRID_DATA_WIDTH * 4
  const sky = skyTableBytes(skySize)
  return Math.ceil(
    images +
      paths * (PT_STATE_BYTES + PT_HIT_BYTES + ptHitMaterialSlotBytes(weighted)) +
      queueWords(bounceLevels, paths) * 4 +
      bounceLevels * PT_STEPS * 12 +
      blockCount * PT_VIEW_STRIDE +
      (PT_LIGHT_TABLE_WORDS + lightCapacity * PT_LIGHT_FLOATS) * 4 +
      gridCells * 3 * 4 +
      lists +
      sky +
      tables,
  )
}

/** Everything the path tracer keeps on the GPU, made for one view size and set of counts, remade where they change. */
export class PathTracingGpu {
  readonly images: readonly [PathTracingImages, PathTracingImages]
  readonly cameraNormals: GPUTexture
  readonly states: GPUBuffer
  /** What each path's ray met this bounce (`PT_HIT_BYTES` a path) and the material the shade of the hits gave it (`ptHitMaterialSlotBytes`: the layout with the weight of the slab only where the view's pixels hold several closures). */
  readonly hits: GPUBuffer
  readonly materials: GPUBuffer
  /** The surfaces the cut's placements wear (`hitPlacements.ts`), made again when it outgrows. */
  placements: GPUBuffer
  readonly queue: GPUBuffer
  /** The arguments of the indirect dispatch over the paths of each bounce (three words each). */
  readonly args: GPUBuffer
  readonly blocks: GPUBuffer
  readonly lights: GPUBuffer
  readonly gridParams: GPUBuffer
  readonly grid: GPUTexture
  readonly gridData: GPUTexture
  /** The views the finish of a bounce binds, made once so that its groups are. */
  readonly gridView: GPUTextureView
  readonly gridDataView: GPUTextureView
  /** The sky's sampling table, shared with the other passes that draw directions from the sky (`../skyTable/`), and its views the finish of a bounce binds. */
  readonly sky: SkyTable
  /** The traced atmosphere's block with its options (`PtAtmo`), and the table of its optical depth (one texel while the air is not held; a view of the payload keeps it whole) with the key it was made for. */
  readonly atmosphere: GPUBuffer
  readonly airDepth: GPUTexture
  readonly airDepthView: GPUTextureView
  airDepthKey = ''
  /** The parameters of the table's slices (made with the table, none where the air is not held), the key of the table being made over several images, the next slice to encode, and the key of the atmosphere uniform last written. */
  readonly airParameters: GPUBuffer | undefined
  airDepthBuilding = ''
  airDepthNext = 0
  airUniformKey = ''
  /** The group of the table's kernel, made again only where the table or its parameters were. */
  readonly airDepthGroup = createCachedGroup()
  /** The clouds' block (`PtCloud`), and the two images of the acceleration map (absent until the clouds are admitted, `admitCloudMap`): the image written by this sample, which the trace reads, and the one the sample before wrote, which the build reads; they swap at each sample. */
  readonly cloud: GPUBuffer
  cloudMaps: readonly GPUTexture[] = []
  cloudMapViews: readonly GPUTextureView[] = []
  /** The group of the map's kernel, a slot for each parity of the two images that take turns, so that one is made again only when a resource moved. */
  readonly cloudMapGroup = createCachedGroup(2)
  cloudWritten: 0 | 1 = 0
  /** The names of the clouds' bindings for a group's identity, a list for each image of the map (the block, the image, then the material's), kept while the images and the material's entries are (`cloudResources`). */
  cloudNames: unknown[][] = []
  cloudNamesOf: readonly GPUBindGroupEntry[] | undefined
  readonly errorLevels: GPUBuffer[]
  readonly display: GPUBuffer
  readonly normalView: GPUBuffer
  readonly varianceDims: GPUBuffer
  private readonly made: { destroy(): void }[] = []

  readonly device: GPUDevice
  readonly size: readonly [number, number]
  readonly tile: number
  readonly bounceLevels: number
  readonly blockCount: number
  readonly gridResolution: number
  readonly lightCapacity: number
  readonly gridCapacity: number
  /** The side the air's table was made at: 0 while the air is not held (the table is then one texel, outside the budget's count). */
  readonly airSide: number

  constructor(
    device: GPUDevice,
    size: readonly [number, number],
    tile: number,
    bounceLevels: number,
    blockCount: number,
    gridResolution: number,
    lightCapacity: number,
    gridCapacity: number,
    skySize: number,
    airSide: number,
    weighted = false,
  ) {
    this.device = device
    this.size = size
    this.tile = tile
    this.bounceLevels = bounceLevels
    this.blockCount = blockCount
    this.gridResolution = gridResolution
    this.lightCapacity = lightCapacity
    this.gridCapacity = gridCapacity
    this.airSide = airSide
    const [width, height] = size
    const levels = varianceLevels(size)
    const texture = (label: string, format: GPUTextureFormat, mips = 1, w = width, h = height) => {
      const made = device.createTexture({
        label: `Trillion3D path tracer ${label}`,
        size: [w, h],
        format,
        mipLevelCount: mips,
        usage: storageTexture(),
      })
      this.made.push(made)
      return made
    }
    const buffer = (label: string, bytes: number, usage: GPUBufferUsageFlags) => {
      const made = device.createBuffer({
        label: `Trillion3D path tracer ${label}`,
        size: Math.max(16, bytes),
        usage,
      })
      this.made.push(made)
      return made
    }
    const imageSet = (parity: number): PathTracingImages => {
      const variance = texture(`variance ${parity}`, PT_VARIANCE_FORMAT, levels)
      return {
        radiance: texture(`radiance ${parity}`, PT_RADIANCE_FORMAT),
        albedo: texture(`albedo ${parity}`, PT_AOV_FORMAT),
        normal: texture(`normal ${parity}`, PT_AOV_FORMAT),
        variance,
        varianceTop: variance.createView({ baseMipLevel: 0, mipLevelCount: 1 }),
        depth: texture(`depth ${parity}`, PT_DEPTH_FORMAT),
      }
    }
    this.images = [imageSet(0), imageSet(1)]
    this.cameraNormals = texture('camera normals', PT_AOV_FORMAT)
    const paths = tile * tile
    this.states = buffer('states', paths * PT_STATE_BYTES, GPUBufferUsage.STORAGE)
    this.hits = buffer('hits', paths * PT_HIT_BYTES, GPUBufferUsage.STORAGE)
    this.materials = buffer(
      'hit materials',
      paths * ptHitMaterialSlotBytes(weighted),
      GPUBufferUsage.STORAGE,
    )
    this.placements = buffer('placements', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST)
    this.queue = buffer(
      'queue',
      queueWords(bounceLevels, paths) * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )
    this.args = buffer(
      'dispatch arguments',
      bounceLevels * PT_STEPS * 12,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    )
    this.blocks = buffer(
      'dispatch parameters',
      blockCount * PT_VIEW_STRIDE,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    this.lights = buffer(
      'lights',
      (PT_LIGHT_TABLE_WORDS + lightCapacity * PT_LIGHT_FLOATS) * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    )
    this.gridParams = buffer(
      'light grid parameters',
      64,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    this.grid = this.device.createTexture({
      label: 'Trillion3D path tracer light grid',
      size: [gridResolution, gridResolution, 3],
      format: PT_GRID_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
    this.made.push(this.grid)
    const rows = Math.max(
      1,
      ceilDiv(gridCapacity * 3 * gridResolution * gridResolution, PT_GRID_DATA_WIDTH),
    )
    this.gridData = texture('light grid lists', PT_GRID_FORMAT, 1, PT_GRID_DATA_WIDTH, rows)
    this.sky = createSkyTable(device, skySize, 'Trillion3D path tracer')
    this.made.push(this.sky)
    this.gridView = this.grid.createView({ dimension: '2d-array' })
    this.gridDataView = this.gridData.createView()
    this.atmosphere = buffer(
      'atmosphere',
      PT_AIR_BYTES,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    // The table and its parameters are made with the rest, so that the budget's admission of the tracer covers them whole.
    this.airDepth = texture(
      'air optical depth',
      PT_AIR_DEPTH_FORMAT,
      1,
      Math.max(airSide, 1),
      Math.max(airSide, 1),
    )
    this.airDepthView = this.airDepth.createView()
    if (airSide > 0)
      this.airParameters = buffer(
        'air optical depth parameters',
        airParameterBytes(airSide),
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      )
    this.cloud = buffer('clouds', PT_CLOUD_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
    this.errorLevels = Array.from({ length: Math.max(levels - 1, 1) }, (_, level) =>
      buffer(`error level ${level}`, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    )
    this.display = buffer('display', 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
    this.normalView = buffer('normal space', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST)
    this.varianceDims = buffer(
      'variance sizes',
      16,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    )
    device.queue.writeBuffer(this.varianceDims, 0, new Uint32Array([width, height, levels, 0]))
    this.errorLevels.forEach((level, at) =>
      device.queue.writeBuffer(
        level,
        0,
        new Int32Array([
          Math.max(width >> at, 1),
          Math.max(height >> at, 1),
          Math.max(width >> (at + 1), 1),
          Math.max(height >> (at + 1), 1),
        ]),
      ),
    )
  }

  /** The images of the clouds' acceleration map made again `side` texels across (the map starts over at the next sample, whose build reads nothing of them). */
  setCloudMap(side: number) {
    if (this.cloudMaps[0]?.width === side) return
    // The new images are made before the old ones go: a refusal of the budget leaves the old ones whole.
    const maps = [0, 1].map((at) =>
      this.device.createTexture({
        label: `Trillion3D path tracer cloud acceleration map ${at}`,
        size: [side, side],
        format: PT_CLOUD_MAP_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      }),
    )
    this.releaseCloudMap()
    this.cloudMaps = maps
    this.made.push(...this.cloudMaps)
    this.cloudMapViews = this.cloudMaps.map((map) => map.createView())
    this.cloudNames = this.cloudMapViews.map((view) => [this.cloud, view])
    this.cloudNamesOf = undefined
  }

  /** Gives the clouds' two maps back to the budget: they are made again when the clouds are traced next. */
  releaseCloudMap() {
    for (const map of this.cloudMaps) {
      map.destroy()
      this.made.splice(this.made.indexOf(map), 1)
    }
    this.cloudMaps = []
    this.cloudMapViews = []
    this.cloudNames = []
    this.cloudNamesOf = undefined
    this.cloudWritten = 0
  }

  /** The bytes the air's table (with its parameters) and the clouds' two maps hold now: the maps are made in place, so this follows the side they were last made at. */
  volumeBytes() {
    return airBytesOf(this.airSide) + volumeTablesBytes(0, this.cloudMaps[0]?.width ?? 0)
  }

  /** Writes the table of the placements' surfaces, in a buffer of its own where it does not fit the last. */
  writePlacements(words: Uint32Array<ArrayBuffer>) {
    if (words.byteLength > this.placements.size) {
      this.placements.destroy()
      this.made.splice(this.made.indexOf(this.placements), 1)
      this.placements = this.device.createBuffer({
        label: 'Trillion3D path tracer placements',
        size: nextPow2(words.byteLength),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
      this.made.push(this.placements)
    }
    this.device.queue.writeBuffer(this.placements, 0, words)
  }

  destroy() {
    for (const resource of this.made) resource.destroy()
    this.made.length = 0
  }
}

/** The lights the buffer holds room for: the count asked taken up to the next power of two, at least 4, so that the resources are made again only when the count doubles, as the engine's other pools grow. */
export const lightRoom = (count: number) => clamp(nextPow2(count), 4, PT_LIGHT_MAXIMUM)
