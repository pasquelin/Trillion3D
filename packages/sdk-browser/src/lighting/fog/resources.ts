import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { heldBuffers } from '../../gpu/core/heldBuffers.ts'
import { writeChanged } from '../../gpu/core/writeChanged.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import {
  allocatedTextures,
  createHeldTextures,
  listedBytes,
  type AllocatedTextures,
} from '../../gpu/core/heldTextures.ts'
import type { ResourceAllocator } from '../../gpu/core/resourceAllocator.ts'
import { standInTexture } from '../../gpu/core/standIns.ts'
import {
  FOG_STATIC_FORMAT,
  FOG_TRACED_FORMAT,
  FOG_VOLUME_FRAME_WORDS,
  type FogGrid,
} from './layout.ts'
import { type FogProgramName } from './bindings.ts'
import { graphLayoutEntries, layoutEntries } from './layoutEntries.ts'
import { fogGraphProgram, fogProgramsFor } from './programs.ts'
import { hasFloat32Filterable } from '../../gpu/core/float32Filterable.ts'
import type { VoxelGraphSet } from './voxelGraph.ts'
import { FOG_VOLUME_FORMAT } from './read.ts'
import { postSamplers } from '../../gpu/core/postSamplers.ts'

/** The scatters made at the first ask, the plain `scatter` serving in place of them until then. */
export type LazyProgram = 'scatterSky' | 'scatterSampled' | 'scatterSkySampled'
const LAZY_PROGRAMS: readonly LazyProgram[] = ['scatterSky', 'scatterSampled', 'scatterSkySampled']

/** The entry points of the programs. */
const ENTRY_POINT = {
  furthest: 'furthestMain',
  scatter: 'scatterMain',
  scatterSky: 'scatterMain',
  scatterSampled: 'scatterMain',
  scatterSkySampled: 'scatterMain',
  static: 'staticMain',
  integrate: 'integrateMain',
  prepare: 'prepareMain',
  voxelize: 'voxelizeMain',
} as const satisfies Record<FogProgramName, string>

const TRACED_HELD_LABEL = 'Trillion3D fog traced lights'

/** The textures of one grid, asked of `allocator`: the volume of the scatter twice — this image's, the previous —, the
 *  integrated volume, and the furthest depth twice; where `voxels` holds, the two volumes the
 *  objects of the volume material domain are voxelised into (their scattering with the extinction,
 *  their emissive light); where `baked` holds, the volume of the static term's pass (`FOG_STATIC_FORMAT`). A 3D texture of half floats, the grid's cells; a 2D one of floats, its
 *  cells across the image. */
function volumeTextures(
  allocator: ResourceAllocator,
  grid: FogGrid,
  voxels: boolean,
  baked: boolean,
) {
  const volume = (label: string, format: GPUTextureFormat = FOG_VOLUME_FORMAT) =>
    allocator.texture(label, [grid.x, grid.y, grid.z], format, { dimension: '3d' })
  const plane = (label: string) => allocator.texture(label, [grid.x, grid.y], 'r32float')
  return {
    grid,
    scattering: [volume('scattering 0'), volume('scattering 1')],
    integrated: volume('integrated'),
    furthest: [plane('depth 0'), plane('depth 1')],
    voxel: voxels ? ([volume('voxel medium'), volume('voxel emissive')] as const) : undefined,
    baked: baked ? volume('static term', FOG_STATIC_FORMAT) : undefined,
  }
}

/** The volume of the lights' ray traced shadows (`FOG_TRACED_FORMAT`), kept apart from the others so that its growth with the lights costs the scatter's history nothing: `words` words
 *  of the light buffer's ranks, one above the other in depth, each as deep as the grid. */
function tracedTextures(allocator: ResourceAllocator, grid: FogGrid, words: number) {
  return {
    grid,
    words,
    volume: allocator.texture(
      'traced shadows',
      [grid.x, grid.y, grid.z * words],
      FOG_TRACED_FORMAT,
      {
        dimension: '3d',
      },
    ),
  }
}

/** The textures of a grid, with the allocator that holds them and the bytes they take. */
export type VolumeTextures = AllocatedTextures<ReturnType<typeof volumeTextures>>

/** A program of the volume: its layout and its pipeline. */
interface FogProgram {
  layout: GPUBindGroupLayout
  pipeline: ReturnType<ReturnType<typeof preparedComputeStage>['ask']>
}

/** A program of the volume from its layout `entries` and its `module`: the layout, and the pipeline
 *  asked now, off the frame (`failed` hears a refusal). */
function makeProgram(
  device: GPUDevice,
  failed: (error: unknown) => void,
  label: string,
  entries: GPUBindGroupLayoutEntry[],
  module: GPUShaderModule,
  entryPoint: string,
): FogProgram {
  const layout = device.createBindGroupLayout({ entries })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const pipeline = preparedComputeStage(
    device,
    pipelineLayout,
    module,
    entryPoint,
    undefined,
    label,
  ).ask()
  pipeline.prepare().catch(failed)
  return { layout, pipeline }
}

/** The layout and the pipeline of each program but the sky scatter, the pipelines asked now, off the frame; the
 *  sky scatter, whose pipeline is asked at the first image that wants it (`skyScatter`); and the
 *  voxelisation of the set of graphs the image holds, asked when it first does (`graphVoxelize`),
 *  with the set before it kept: a camera that walks across the edge of a fog object with a graph
 *  flips between two sets, and neither compiles again. */
function createFogPrograms(device: GPUDevice, failed: (error: unknown) => void, local: boolean) {
  const filterableMip = hasFloat32Filterable(device.features)
  const program = (name: FogProgramName): FogProgram => {
    const label = `Trillion3D fog ${name}`
    const module = device.createShaderModule({
      label,
      code: fogProgramsFor(local, filterableMip)[name],
    })
    return makeProgram(
      device,
      failed,
      label,
      layoutEntries(name, filterableMip),
      module,
      ENTRY_POINT[name],
    )
  }
  const programs = {} as Record<Exclude<FogProgramName, LazyProgram>, FogProgram>
  for (const name of Object.keys(fogProgramsFor(local, filterableMip)) as FogProgramName[])
    if (!LAZY_PROGRAMS.includes(name as LazyProgram))
      programs[name as Exclude<FogProgramName, LazyProgram>] = program(name)
  const lazy: Partial<Record<LazyProgram, FogProgram>> = {}
  const lazyProgram = (name: LazyProgram) => (lazy[name] ??= program(name))
  // The voxelisation of the set in place and of the one before it, the more recent first.
  const graphs: { key: string; program: FogProgram }[] = []
  const graphVoxelize = (set: VoxelGraphSet) => {
    const at = graphs.findIndex(({ key }) => key === set.key)
    if (at > 0) graphs.unshift(...graphs.splice(at, 1))
    if (at >= 0) return graphs[0]!.program
    const label = 'Trillion3D fog voxelize graphs'
    const module = device.createShaderModule({ label, code: fogGraphProgram(set) })
    const entries = graphLayoutEntries(set.textured)
    const program = makeProgram(device, failed, label, entries, module, ENTRY_POINT.voxelize)
    graphs.unshift({ key: set.key, program })
    graphs.length = Math.min(graphs.length, 2)
    return program
  }
  return {
    programs,
    skyScatter: () => lazyProgram('scatterSky'),
    /** The scatter with the local lights lit by samples, with or without the distance field's sky visibility. */
    sampledScatter: (sky: boolean) => lazyProgram(sky ? 'scatterSkySampled' : 'scatterSampled'),
    graphVoxelize,
  }
}

/** Whether `held` are the textures of `grid` and hold the voxelised objects' volumes where `voxels`
 *  asks for them, the static term's where `baked` does. */
const holds = (held: VolumeTextures, grid: FogGrid, voxels: boolean, baked: boolean) =>
  held.grid === grid && !!(held.voxel || !voxels) && !!(held.baked || !baked)

/** The volume of `format` an image that has no such pass binds: one cell the scatter does not read (the
 *  frame says so). */
function createVolumeStandIn(device: GPUDevice, label: string, format: GPUTextureFormat) {
  const texture = standInTexture(device, label, format, {
    dimension: '3d',
    storage: true,
  })
  return { texture, view: texture.createView({ dimension: '3d' }) }
}

/** The textures of the grid the volume holds (`createHeldTextures`), made again when the grid changes,
 *  and how they are asked: those of `grid` where the held ones are — and, where `voxels` asks for the
 *  voxelised objects' volumes or `baked` for the static term's, they are among them —, else new ones,
 *  with those volumes too if the held ones had them; none where the device's budget refuses them. */
function createFogTextures(device: GPUDevice) {
  const held = createHeldTextures<ReturnType<typeof volumeTextures>>(device)
  const texturesOf = (grid: FogGrid, voxels = false, baked = false) =>
    held.texturesOf(
      (textures) => holds(textures, grid, voxels, baked),
      (textures) => {
        const keptVoxels = voxels || !!textures?.voxel
        const keptBaked = baked || !!textures?.baked
        const list = (allocator: ResourceAllocator) =>
          volumeTextures(allocator, grid, keptVoxels, keptBaked)
        return {
          asked: listedBytes(list),
          what: 'the fog volume',
          make: () => allocatedTextures(device, 'Trillion3D fog', list),
        }
      },
    )
  const tracedHeld = createHeldTextures<ReturnType<typeof tracedTextures>>(device)
  /** The traced shadows' volume of `grid` holding `words` words at least, made again (and only it) where the held one holds fewer or is another grid's; none where the budget refuses it. */
  const tracedOf = (grid: FogGrid, words: number) =>
    tracedHeld.texturesOf(
      (textures) => textures.grid === grid && textures.words >= words,
      () => {
        const list = (allocator: ResourceAllocator) => tracedTextures(allocator, grid, words)
        return {
          asked: listedBytes(list),
          what: 'the fog traced shadows',
          make: () => allocatedTextures(device, 'Trillion3D fog traced', list),
        }
      },
    )
  return { held, texturesOf, tracedHeld, tracedOf }
}

/**
 * WHAT THE VOLUME'S PASSES ARE MADE OF, made once (`createFogVolumeGpu`): the frame's buffer, the
 * layout and the pipeline of each program — asked now, off the frame —, and the textures of the
 * grid (`createFogTextures`). The textures are the device's budget's to refuse: the volume is then
 * built by none, and asked again at the next image.
 */
export function createFogVolumeResources(
  device: GPUDevice,
  failed: (error: unknown) => void,
  local = true,
) {
  const frame = uniformBlock(device, 'Trillion3D fog frame', FOG_VOLUME_FRAME_WORDS * 4)
  const { programs, skyScatter, sampledScatter, graphVoxelize } = createFogPrograms(
    device,
    failed,
    local,
  )
  const textures = createFogTextures(device)
  let standIn: ReturnType<typeof createVolumeStandIn> | undefined
  let tracedStandIn: ReturnType<typeof createVolumeStandIn> | undefined
  const buffers = heldBuffers()
  const release = () => {
    textures.held.release()
    textures.tracedHeld.release()
  }
  return {
    /** The frame the passes read: its words, written each image, and its buffer, sent by what
     *  changed (`uniformBlock`). */
    frame,
    programs,
    /** The scatter that finds the sky's visibility of each sample in the global distance field, its pipeline asked at the
     *  first call: the plain scatter serves until it is `ready`. */
    skyScatter,
    /** The scatters that light the local lights by samples (`sampledLightsVolume`), with and without the sky's visibility, their pipelines asked at the first call: the plain ones serve until they are `ready`. */
    sampledScatter,
    /** The voxelisation that evaluates the graphs of `set`, its pipeline asked at the first call: the plain
     *  voxelisation serves until it is `ready`. */
    graphVoxelize,
    /** The sampler the scatter reads the previous volume and the cubemap through (the one of the device). */
    sampler: postSamplers(device).mipped,
    get generation() {
      return textures.held.generation
    },
    get bytes() {
      return textures.held.bytes + textures.tracedHeld.bytes
    },
    /** The static term's volume of an image that has no such pass, made at the first call. */
    get bakedStandIn() {
      return (standIn ??= createVolumeStandIn(
        device,
        'Trillion3D fog no static term',
        FOG_STATIC_FORMAT,
      )).view
    },
    /** The traced shadows' volume of an image that holds none, made at the first call. */
    get tracedStandIn() {
      return (tracedStandIn ??= createVolumeStandIn(
        device,
        'Trillion3D fog no traced shadows',
        FOG_TRACED_FORMAT,
      )).view
    },
    /** The buffer of the lights whose ray traced shadow the volume holds, a bit a rank (`FOG_TRACED_WORD_BITS` a word): with `words`, the first `count` of them written into it, grown as the light buffer is. */
    tracedHeld(words?: Uint32Array<ArrayBuffer>, count = 0) {
      const buffer = buffers.grow(
        device,
        TRACED_HELD_LABEL,
        Math.max(count, 1) * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      )
      if (words) writeChanged(device, buffer, words, 0, count)
      return buffer
    },
    texturesOf: textures.texturesOf,
    tracedOf: textures.tracedOf,
    release,
    dispose() {
      release()
      frame.buffer.destroy()
      standIn?.texture.destroy()
      tracedStandIn?.texture.destroy()
      buffers.drop(device, TRACED_HELD_LABEL)
    },
  }
}

/** What `createFogVolumeResources` made. */
export type FogVolumeResources = ReturnType<typeof createFogVolumeResources>
