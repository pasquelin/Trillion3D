import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { volumetricFogKnobs } from '../../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { writeFogVolumeFrame, type FogVolumeImage, type FogVolumePrevious } from './frame.ts'
import { DEFAULT_MAX_VOLUME_DIMENSION, historyHorizon, type FogGrid } from './layout.ts'
import { NO_GRID, gridsOf } from './gridsOf.ts'
import { graphPass } from './graphPass.ts'
import { createFogGroups, encodeFogPasses, type FogPassInputs } from './passes.ts'
import { newFogStaticLight, staticTermWanted } from './staticLight.ts'
import type { FogRead } from './read.ts'
import { createFogVolumeResources, type FogVolumeResources } from './resources.ts'
import { createVoxelBuffers, type VoxelBuffers, type VoxelGraphMaps } from './voxelGpu.ts'
import type { SceneFogVolumeStore } from '../../../../sdk-core/src/scene/volume/store.ts'
import type { GraphClocks } from '../../materials/graph/clocks.ts'

/** What one image gives the volume's passes: the image — its camera, the medium, the run's settings,
 *  the sun's rank, the light grid's columns and rows, the image's number (`FogVolumeImage`), minus
 *  the previous image, which the volume keeps, the grids and the furthest-depth switch, which it
 *  decides — and the resources it reads: the scene's depth and its pyramid, the light buffer and
 *  its light lists, the virtual shadow maps the sun's shadow reads (the very ones a blended surface
 *  binds), and the fog's cubemap, none where it has none — with what it takes of the baked light
 *  (`FogStaticLight`) and the lightmap that light is read from, none where the image reads none. */
export interface FogVolumeInputs
  extends
    Omit<
      FogVolumeImage,
      'previous' | 'grid' | 'resource' | 'rebuildSamples' | 'skipHidden' | 'voxels' | 'staticBuilt'
    >,
    FogPassInputs {
  /** The objects of the volume material domain, none where the scene holds none. */
  volumes?: SceneFogVolumeStore
  /** What the voxelisation reads of the colour atlas for the textures the objects' graphs read. */
  graphMaps?: VoxelGraphMaps
  /** The clocks their graphs read, in seconds: the image's (`WebgpuRun.graphClocks`). */
  graphClocks?: GraphClocks
  /** A camera cut: the image before is no history for this one. */
  cut?: boolean
  /** The size the targets were made for, pixels: the textures follow it, the camera's size being the
   *  one the image is drawn at, never more. */
  allocated: readonly [number, number]
}

/** An object whose fields hold nothing until the first image writes them, and nothing again once it
 *  is let go: the scratch a frame rewrites in place instead of allocating one (`FogVolumeInputs`,
 *  the volume's image). A reader takes it whole only after the writer has set every field. */
export type Scratch<T> = { -readonly [K in keyof T]: T[K] | undefined }

/** What the volume's image-by-image work holds: the resources, the stand-ins of a fog with no
 *  cubemap and no volume, the groups, the words of the frame, the largest 3D texture. */
interface Parts {
  resources: FogVolumeResources
  none: FogRead
  groups: ReturnType<typeof createFogGroups>
  maxDimension: number
  /** What the frame is written from, refilled each image. */
  image: Scratch<FogVolumeImage>
  /** What the passes are made over, refilled each image. */
  context: Parameters<typeof encodeFogPasses>[1]
  /** The voxelisation's buffers. */
  voxel: VoxelBuffers
}

/** What the volume remembers of the image before: its view-projection and size
 *  (`FogVolumePrevious`), whether it held cells hidden — valid while `known` —, which of the two
 *  scatter volumes it wrote, how many times the textures were made, the cells of the textures it
 *  made for the targets' size, and the cells the view uses. The objects are kept and rewritten: an
 *  image allocates none. */
interface History {
  previous: FogVolumePrevious & { viewProj: Float32Array; skipHidden: boolean }
  known: boolean
  /** Images built on the history of the one before, since it last started over (a first image, a
   *  camera cut, other textures), and how many make it whole (`historyHorizon`). */
  frames: number
  horizon: number
  ping: number
  made: number
  resource: { key: number[]; grid: FogGrid }
  view: { -readonly [K in keyof FogGrid]: FogGrid[K] }
}

/** This image's frame written, where a volume is built: the history the previous image left, if it
 *  can be read (the same textures, no cut, the cells held hidden or not as before). */
function writeFrame(
  { resources, image }: Parts,
  history: History,
  input: FogVolumeInputs,
  knobs: { rebuildSamples: number },
  skipHidden: boolean,
  voxels: boolean,
  staticBuilt: boolean,
) {
  const { previous } = history
  const kept = history.known && !input.cut && previous.skipHidden === skipHidden
  image.camera = input.camera
  image.medium = input.medium
  image.settings = input.settings
  image.sunRank = input.sunRank
  image.lightCells = input.lightCells
  image.frameIndex = input.frameIndex
  image.preExposure = input.preExposure
  image.grid = history.view
  image.resource = history.resource.grid
  image.rebuildSamples = knobs.rebuildSamples
  image.skipHidden = skipHidden
  image.voxels = voxels
  image.staticLight = input.staticLight
  image.staticBuilt = staticBuilt
  image.previous = kept ? previous : undefined
  writeFogVolumeFrame(resources.frame.words.f, image as FogVolumeImage)
  resources.frame.send()
  return kept
}

/** The volume of one image, built in the run `steps` (`createFogVolumeGpu`): its integrated view, none
 *  where the quality is `off` or the device's budget refuses the
 *  textures. */
function buildVolume(parts: Parts, history: History, steps: ComputeRun, input: FogVolumeInputs) {
  const { resources, none, maxDimension, context } = parts
  const knobs = volumetricFogKnobs(input.settings.volumetricFogQuality)
  const { camera } = input
  if (!knobs) return void ((history.known = false), (history.frames = 0))
  gridsOf(history, camera, input.allocated, knobs, maxDimension)
  const voxels = parts.voxel.write(
    input.volumes,
    camera,
    input.settings,
    input.medium,
    input.graphMaps,
    input.graphClocks,
  )
  parts.context.graph = graphPass(parts.voxel, parts.resources, parts.groups, input.graphMaps)
  const staticBuilt = !!input.lightmap && staticTermWanted(input.staticLight)
  const textures = resources.texturesOf(history.resource.grid, voxels > 0, staticBuilt)
  if (!textures) return void ((history.known = false), (history.frames = 0))
  if (resources.generation !== history.made) {
    history.made = resources.generation
    history.known = false
  }
  // Cells are held hidden where the setting says and the frame built the pyramid they are read from.
  const skipHidden = input.settings.volumetricFogSkipHidden && !!input.hiz
  const kept = writeFrame(parts, history, input, knobs, skipHidden, voxels > 0, staticBuilt)
  history.frames = kept ? history.frames + 1 : 1
  history.horizon = historyHorizon(input.settings)
  context.voxelObjects = voxels
  context.staticBuilt = staticBuilt
  context.ping = history.ping
  context.cells = history.view
  context.whiteCubemap = none.cubemap
  encodeFogPasses(steps, context, input, textures, skipHidden)
  const { previous } = history
  previous.viewProj.set(camera.viewProj)
  previous.width = camera.width
  previous.height = camera.height
  previous.preExposure = input.preExposure
  previous.skipHidden = skipHidden
  history.known = true
  history.ping = 1 - history.ping
  return textures.integrated
}

/** What an image's work holds (`Parts`), made once: nothing in it is allocated again. */
function newParts(device: GPUDevice, resources: FogVolumeResources, none: FogRead): Parts {
  const voxel = createVoxelBuffers(device)
  const groups = createFogGroups()
  return {
    resources,
    none,
    groups,
    maxDimension: device.limits?.maxTextureDimension3D ?? DEFAULT_MAX_VOLUME_DIMENSION,
    image: {
      camera: undefined,
      previous: undefined,
      grid: NO_GRID,
      resource: NO_GRID,
      medium: undefined,
      settings: undefined,
      rebuildSamples: 0,
      skipHidden: false,
      voxels: false,
      staticLight: newFogStaticLight(),
      staticBuilt: false,
      sunRank: -1,
      lightCells: [0, 0],
      frameIndex: 0,
      preExposure: 1,
    },
    context: {
      device,
      resources,
      groups,
      whiteCubemap: none.cubemap,
      emptyVolume: none.volume,
      ping: 0,
      cells: NO_GRID,
      voxel,
      voxelObjects: 0,
      staticBuilt: false,
    },
    voxel,
  }
}

/** What the volume remembers (`History`), at the start: nothing known. */
const newHistory = (): History => ({
  previous: {
    viewProj: new Float32Array(16),
    width: 0,
    height: 0,
    preExposure: 1,
    skipHidden: false,
  },
  known: false,
  frames: 0,
  horizon: 0,
  ping: 0,
  made: 0,
  resource: { key: [0, 0, 0, 0], grid: NO_GRID },
  view: { ...NO_GRID },
})

/**
 * THE FOG VOLUME'S GPU WORK, made once a scene turns the volume on and kept while it does: the
 * passes (`FOG_PROGRAMS`), the textures of the grid, and what it remembers of the image before —
 * its view-projection, its grid, whether it held cells hidden, the volume and the furthest depth it
 * wrote. `none`, the stand-ins a fog with no cubemap is bound to (`createFogStandIns`), which the
 * caller owns. One per view: a view that draws beside another has a volume and a history of its own.
 *
 * Each image it builds the volume in passes: the furthest depth around each cell across the
 * image, the objects of the volume material domain voxelised into the medium (where the scene
 * holds any), the light each cell scatters blended with the volume of the image before, and the
 * sum along each column. It builds none — `encode` answers no volume — where the quality is `off` or the
 * budget refuses the textures. Its pipelines compile off the
 * frame (`ask`): the frames wait for them. The passes hold the local fog volumes' code unless `local` is
 * false, the project switch `localFogVolumeSupport` off.
 */
export function createFogVolumeGpu(
  device: GPUDevice,
  failed: (error: unknown) => void,
  none: FogRead,
  local = true,
) {
  const resources = createFogVolumeResources(device, failed, local)
  const parts = newParts(device, resources, none)
  const history = newHistory()
  const pipelines = Object.values(resources.programs).map((program) => program.pipeline)
  return {
    /** Whether the volume still advances toward the picture its history converges to: a still view
     *  is drawn again till it is whole (`historyHorizon` images), then held. */
    get settling() {
      return history.known && history.frames < history.horizon
    },
    /** Whether the objects the last image voxelised wear a graph that reads the time: the volume
     *  changes from one image to the next with nothing else moving, so the image is never held. */
    get animated() {
      return !!parts.voxel.graphs?.programs.some((program) => program.compiled.uses.time)
    },
    /** Whether every pipeline is compiled: until then the image builds no volume. */
    get ready() {
      for (const pipeline of pipelines) if (!pipeline.ready) return false
      return true
    },
    /** Bytes of the textures the volume holds. */
    get bytes() {
      return resources.bytes
    },
    /** The words of the frame the last built image wrote: what the view block is made from. */
    get frame() {
      return resources.frame.words.f
    },
    /** The volume of this image, built in the run `steps`: its integrated view, which a surface's program
     *  reads, or none. */
    encode: (steps: ComputeRun, input: FogVolumeInputs) =>
      buildVolume(parts, history, steps, input),
    /** The scene's fog changed to one with no volume, or the world closed: the history is dropped
     *  and the textures retired. */
    reset() {
      history.known = false
      resources.release()
    },
    dispose() {
      resources.dispose()
      parts.voxel.dispose()
    },
  }
}

/** The volume's GPU work (`createFogVolumeGpu`). */
export type FogVolumeGpu = ReturnType<typeof createFogVolumeGpu>
