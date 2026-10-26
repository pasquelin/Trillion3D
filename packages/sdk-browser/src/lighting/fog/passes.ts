import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { FOG_VOLUME_PASS } from '../../diagnostic/stage/passLabels.ts'
import type { SkyLightReadSet } from '../../modules/sky/skyLight/read.ts'
import type { CloudShadowSet } from '../atmosphere/cloudShadowRead.ts'
import { hizDepthBindEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import type { HizDepth } from '../../visibility/hiz/gpu/types.ts'
import type { GlobalFieldRead } from '../distanceField/view.ts'
import type { VolumetricLightmapGpu } from '../volumetricLightmap/gpu.ts'
import { FOG_BINDING } from './bindings.ts'
import type { FogGrid } from './layout.ts'
import type { FogVolumeResources, VolumeTextures } from './resources.ts'
import {
  createProgramGroups,
  heldProgramGroup,
  keptProgramGroup,
} from '../../gpu/bind/programGroups.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { VoxelBuffers } from './voxelGpu.ts'
import { encodeStatic } from './staticPass.ts'
import { encodeVoxels, type VoxelGraphPass } from './voxelPasses.ts'

/** What one image gives the volume's passes: the scene's depth and, where this image built the depth
 *  pyramid's farthest layer of the finished opaque depth before the volume (after the raster's rest
 *  pass and the transparents' front pass: `opaquePyramidOf`), its resources (`GpuHiz.depth`) — the
 *  furthest depth is read from them; without, no cell is held hidden —, the light buffer and its
 *  light lists, the virtual shadow maps the sun's shadow reads (the very ones a blended surface
 *  binds), and the fog's cubemap, none where it has none. */
export interface FogPassInputs {
  depth: GPUTextureView
  hiz?: HizDepth
  lights: GPUBuffer
  tiles: GPUBuffer
  /** The lists of the local fog volumes over each tile of the view the cells walk, or the stand-in
   *  that leaves the cells every volume of the view (`localFogTiled`). */
  localTiles: GPUBuffer
  vsm: {
    pageTable: GPUBuffer
    projectionData: GPUBuffer
    uniforms: GPUBuffer
    pool: GPUBuffer
    view: GPUBuffer
  }
  cubemap?: GPUTextureView
  /** The light functions' atlas and its table, or the stand-in that answers none. */
  lightFunction: GPUTextureView
  /** The shade the clouds cast on the sun, or the stand-in that casts none. */
  cloudShadow: CloudShadowSet
  /** The sky light's harmonics and uniform, or the stand-in that gives none. */
  sky: SkyLightReadSet
  /** The global distance field, where each sample of a cell finds the sky's visibility in it (`distanceFieldSkyOcclusion`
   *  gives it under its gate); none, the sky is wholly visible. */
  field?: GlobalFieldRead
  /** The volumetric lightmap, where the image reads one (`volumetricLightmapOf`): the static term's pass
   *  reads it. */
  lightmap?: VolumetricLightmapGpu
}

/** The bind groups of the three programs, made again only where a resource they name was replaced:
 *  nothing is allocated in an image whose resources are those of two images before. */
export function createFogGroups() {
  return {
    furthest: createProgramGroups(),
    scatter: createProgramGroups(),
    scatterSky: createProgramGroups(),
    static: createProgramGroups(),
    integrate: createProgramGroups(),
    prepare: createProgramGroups(),
    voxelize: createProgramGroups(),
    voxelizeGraph: createProgramGroups(),
  }
}

/** The groups of the volume's programs (`createFogGroups`). */
export type FogGroups = ReturnType<typeof createFogGroups>

/** What the passes of an image are made over: the device, the resources, the groups, the stand-in
 *  cubemap and the stand-in volume, which of the two scatter volumes this image writes and the cells
 *  the view uses of the textures (the threads dispatched: the textures may hold more); the
 *  voxelisation's buffers and the objects it voxelises this image, none where it voxelises none. */
export interface FogPassContext {
  device: GPUDevice
  resources: FogVolumeResources
  groups: FogGroups
  whiteCubemap: GPUTextureView
  emptyVolume: GPUTextureView
  ping: number
  cells: FogGrid
  voxel: VoxelBuffers
  voxelObjects: number
  /** The voxelisation of the objects' graphs this image (`VoxelGraphPass`), none where they wear none. */
  graph?: VoxelGraphPass
  /** Whether the static term's pass runs this image (`FogVolumeImage.staticBuilt`). */
  staticBuilt: boolean
}

/** The entries of the furthest depth's group: the frame, the pyramid, the plane written. */
function furthestEntries(resources: FogVolumeResources, hiz: HizDepth, plane: GPUTextureView) {
  return [
    ...namedEntries(FOG_BINDING, {
      frame: { buffer: resources.frame.buffer },
      furthestOut: plane,
    }),
    ...hizDepthBindEntries(FOG_BINDING.hiz, hiz),
  ]
}

/** The entries of the scatter's group: the light buffer and its lists, the depth, the furthest depth
 *  of this image and of the one before, the volume before and the one written, the cubemap and the
 *  shadow maps. */
function scatterEntries(context: FogPassContext, input: FogPassInputs, textures: VolumeTextures) {
  const { resources, ping, whiteCubemap } = context
  const { vsm } = input
  const planes = textures.furthest
  return namedEntries(FOG_BINDING, {
    lights: { buffer: input.lights },
    tiles: { buffer: input.tiles },
    localTiles: { buffer: input.localTiles },
    frame: { buffer: resources.frame.buffer },
    depth: input.depth,
    furthest: planes[ping],
    previousFurthest: planes[1 - ping],
    previousVolume: textures.scattering[1 - ping],
    sampler: resources.sampler,
    scattering: textures.scattering[ping],
    cubemap: input.cubemap ?? whiteCubemap,
    voxelIn: voxelViews(context, textures)[0],
    voxelEmitIn: voxelViews(context, textures)[1],
    pageTable: { buffer: vsm.pageTable },
    projectionData: { buffer: vsm.projectionData },
    shadowUniforms: { buffer: vsm.uniforms },
    shadowPool: { buffer: vsm.pool },
    shadowView: { buffer: vsm.view },
    lightFunction: input.lightFunction,
    cloudShadow: { buffer: input.cloudShadow.block },
    cloudShadowMap0: input.cloudShadow.maps[0],
    cloudShadowMap1: input.cloudShadow.maps[1],
    skyHarmonics: { buffer: input.sky.harmonics },
    skyParams: { buffer: input.sky.params },
    staticIn: textures.baked ?? resources.bakedStandIn,
  })
}

/** The two volumes the scatter reads the voxelised objects from: this image's, where it voxelised
 *  any, else the stand-in volume (the frame's flag then says not to read it). */
const voxelViews = ({ emptyVolume }: FogPassContext, textures?: VolumeTextures) =>
  textures?.voxel ? [textures.voxel[0], textures.voxel[1]] : [emptyVolume, emptyVolume]

/** The entries of the integration's group: the frame, the scatter read, the volume written. */
function integrateEntries(
  resources: FogVolumeResources,
  scatterIn: GPUTextureView,
  integrated: GPUTextureView,
) {
  return namedEntries(FOG_BINDING, {
    frame: { buffer: resources.frame.buffer },
    scatterIn,
    integrated,
  })
}

/** The furthest depth of the cells across the image, from the depth pyramid, into the plane of the
 *  image's `ping`. */
function encodeFurthest(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  hiz: HizDepth,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping } = context
  const { programs } = resources
  const pipeline = programs.furthest.pipeline.get()
  if (!pipeline) return
  const plane = textures.furthest[ping]
  const { next } = groups.furthest.identity
  next[0] = hiz
  next[1] = plane
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    heldProgramGroup(groups.furthest) ??
      keptProgramGroup(
        device,
        programs.furthest.layout,
        groups.furthest,
        furthestEntries(resources, hiz, plane),
      ),
  )
  pass.dispatchWorkgroups(ceilDiv(context.cells.x, 8), ceilDiv(context.cells.y, 8))
}

/** The scatter this image runs and the groups it keeps: the one that finds the sky's visibility of each sample in the
 *  global distance field, where the field is given and the program is compiled (its compile is asked now), else the
 *  plain one. */
function scatterOf(context: FogPassContext, input: FogPassInputs) {
  const { resources, groups } = context
  const sky = input.field && resources.skyScatter()
  return sky?.pipeline.ready
    ? { program: sky, groups: groups.scatterSky, field: input.field }
    : { program: resources.programs.scatter, groups: groups.scatter, field: undefined }
}

const FOG_PASS: GPUComputePassDescriptor = { label: FOG_VOLUME_PASS }

/** The light each cell scatters, blended with the volume of the image before. */
function encodeScatter(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
) {
  const { device, ping, whiteCubemap } = context
  const { program, groups, field } = scatterOf(context, input)
  const pipeline = program.pipeline.get()
  if (!pipeline) return
  const { next } = groups.identity
  const { vsm } = input
  next[0] = input.depth
  next[1] = input.lights
  next[2] = input.tiles
  next[3] = textures.scattering[ping]
  next[4] = textures.scattering[1 - ping]
  next[5] = textures.furthest[ping]
  next[6] = textures.furthest[1 - ping]
  next[7] = input.cubemap ?? whiteCubemap
  next[8] = vsm.pageTable
  next[9] = vsm.projectionData
  next[10] = vsm.uniforms
  next[11] = vsm.pool
  next[12] = vsm.view
  next[13] = textures.voxel?.[0] ?? null
  next[14] = textures.voxel?.[1] ?? null
  next[15] = input.lightFunction
  next[16] = input.cloudShadow.block
  next[17] = input.cloudShadow.maps[0]
  next[18] = input.cloudShadow.maps[1]
  next[19] = field?.readGeneration
  next[20] = input.sky.harmonics
  next[21] = input.sky.params
  next[22] = textures.baked ?? null
  next[23] = input.localTiles
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    heldProgramGroup(groups) ??
      keptProgramGroup(device, program.layout, groups, [
        ...scatterEntries(context, input, textures),
        ...(field?.readEntries(FOG_BINDING.field) ?? []),
      ]),
  )
  const { cells } = context
  pass.dispatchWorkgroups(ceilDiv(cells.x, 4), ceilDiv(cells.y, 4), ceilDiv(cells.z, 4))
}

/** The sum of the cells along each column. */
function encodeIntegrate(
  pass: GPUComputePassEncoder,
  context: FogPassContext,
  textures: VolumeTextures,
) {
  const { device, resources, groups, ping } = context
  const pipeline = resources.programs.integrate.pipeline.get()
  if (!pipeline) return
  const { next } = groups.integrate.identity
  const { scattering, integrated } = textures
  next[0] = scattering[ping]
  next[1] = integrated
  pass.setPipeline(pipeline)
  pass.setBindGroup(
    0,
    heldProgramGroup(groups.integrate) ??
      keptProgramGroup(
        device,
        resources.programs.integrate.layout,
        groups.integrate,
        integrateEntries(resources, scattering[ping], integrated),
      ),
  )
  pass.dispatchWorkgroups(ceilDiv(context.cells.x, 8), ceilDiv(context.cells.y, 8))
}

/**
 * The volume's passes over `textures`, in one compute pass: the furthest depth of the cells across
 * the image (where `skipHidden` holds cells hidden, from the pyramid `input.hiz` names), the objects
 * of the volume material domain voxelised into the volume (where there are any), the light
 * each cell scatters blended with the volume of the image before — each sample lit by the sky's visibility it sees in the
 * global distance field, where that is given —, and the sum along each column.
 * This image's volume is the one `context.ping` names. Every program is compiled when this runs
 * (`FogVolumeGpu.ready`, asked at the frame's entry by `askFogVolume`): none of the passes is skipped
 * alone, so the history and the ping-pong advance only for a volume that was built.
 */
export function encodeFogPasses(
  steps: ComputeRun,
  context: FogPassContext,
  input: FogPassInputs,
  textures: VolumeTextures,
  skipHidden: boolean,
) {
  const pass = steps.pass(FOG_PASS)
  if (skipHidden && input.hiz) encodeFurthest(pass, context, input.hiz, textures)
  if (context.voxelObjects && textures.voxel) encodeVoxels(pass, context, textures.voxel)
  if (context.staticBuilt && input.lightmap && textures.baked)
    encodeStatic(pass, context, input, input.lightmap, textures.baked, textures)
  encodeScatter(pass, context, input, textures)
  encodeIntegrate(pass, context, textures)
}
