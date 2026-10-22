import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { uniformBlock } from '../../gpu/core/uniformBlock.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { ledgerAdmitted } from '../../gpu/core/deviceLedger.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { hizDepthEntries } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { FOG_VOLUME_FRAME_WORDS, type FogGrid } from './layout.ts'
import { FOG_BINDING, FOG_PROGRAM_BINDINGS, FOG_PROGRAMS, type FogProgramName } from './programs.ts'
import { createFogSampler, FOG_VOLUME_FORMAT } from './read.ts'

/** The layout entry of each binding of the volume's programs, by name; the pyramid's three
 *  (`hizDepthEntries`) are made where a program names it. */
const ENTRY: Record<Exclude<keyof typeof FOG_BINDING, 'hiz'>, GPUBindGroupLayoutEntry> = {
  lights: computeBufferEntry(FOG_BINDING.lights, 'read-only-storage'),
  tiles: computeBufferEntry(FOG_BINDING.tiles, 'read-only-storage'),
  frame: computeUniformEntry(FOG_BINDING.frame),
  depth: computeTextureEntry(FOG_BINDING.depth, 'depth'),
  furthest: computeTextureEntry(FOG_BINDING.furthest, 'unfilterable-float'),
  previousFurthest: computeTextureEntry(FOG_BINDING.previousFurthest, 'unfilterable-float'),
  previousVolume: computeTextureEntry(FOG_BINDING.previousVolume, 'float', '3d'),
  sampler: computeSamplerEntry(FOG_BINDING.sampler),
  scattering: computeStorageTextureEntry(
    FOG_BINDING.scattering,
    FOG_VOLUME_FORMAT,
    'write-only',
    '3d',
  ),
  integrated: computeStorageTextureEntry(
    FOG_BINDING.integrated,
    FOG_VOLUME_FORMAT,
    'write-only',
    '3d',
  ),
  furthestOut: computeStorageTextureEntry(FOG_BINDING.furthestOut, 'r32float'),
  scatterIn: computeTextureEntry(FOG_BINDING.scatterIn, 'float', '3d'),
  cubemap: computeTextureEntry(FOG_BINDING.cubemap, 'float', 'cube'),
  pageTable: computeBufferEntry(FOG_BINDING.pageTable, 'read-only-storage'),
  projectionData: computeBufferEntry(FOG_BINDING.projectionData, 'read-only-storage'),
  shadowUniforms: computeUniformEntry(FOG_BINDING.shadowUniforms),
  shadowPool: computeBufferEntry(FOG_BINDING.shadowPool, 'read-only-storage'),
  shadowView: computeUniformEntry(FOG_BINDING.shadowView),
}

/** The layout of a program: the entries of what it binds. */
const layoutEntries = (name: FogProgramName) =>
  (Object.keys(FOG_PROGRAM_BINDINGS[name]) as (keyof typeof FOG_BINDING)[]).flatMap((n) =>
    n === 'hiz' ? hizDepthEntries(FOG_BINDING.hiz, GPUShaderStage.COMPUTE) : [ENTRY[n]],
  )

/** The entry points of the programs. */
const ENTRY_POINT = {
  furthest: 'furthestMain',
  scatter: 'scatterMain',
  integrate: 'integrateMain',
} as const satisfies Record<FogProgramName, string>

/** The textures of one grid: the volume of the scatter twice — this image's, the previous —, the
 *  integrated volume, and the furthest depth twice. A 3D texture of half floats, the grid's cells;
 *  a 2D one of floats, its cells across the image. */
function createVolumeTextures(device: GPUDevice, grid: FogGrid) {
  const made: GPUTexture[] = []
  const make = (descriptor: GPUTextureDescriptor) => {
    const texture = device.createTexture(descriptor)
    made.push(texture)
    return { made: texture, view: texture.createView() }
  }
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const volume = (label: string) =>
    make({
      label,
      dimension: '3d',
      size: { width: grid.x, height: grid.y, depthOrArrayLayers: grid.z },
      format: FOG_VOLUME_FORMAT,
      usage,
    })
  const plane = (label: string) =>
    make({ label, size: { width: grid.x, height: grid.y }, format: 'r32float', usage })
  try {
    return {
      grid,
      scattering: [volume('Trillion3D fog scattering 0'), volume('Trillion3D fog scattering 1')],
      integrated: volume('Trillion3D fog integrated'),
      furthest: [plane('Trillion3D fog depth 0'), plane('Trillion3D fog depth 1')],
    }
  } catch (error) {
    // A refusal midway leaves nothing behind.
    for (const texture of made) texture.destroy()
    throw error
  }
}

/** The textures of a grid (`createVolumeTextures`). */
export type VolumeTextures = ReturnType<typeof createVolumeTextures>

/** The layout and the pipeline of each program, the pipelines asked now, off the frame. */
function createFogPrograms(device: GPUDevice, failed: (error: unknown) => void) {
  const stage = (name: FogProgramName, layout: GPUBindGroupLayout) => {
    const label = `Trillion3D fog ${name}`
    const module = device.createShaderModule({ label, code: FOG_PROGRAMS[name] })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    return preparedComputeStage(
      device,
      pipelineLayout,
      module,
      ENTRY_POINT[name],
      undefined,
      label,
    ).ask()
  }
  const programs = {} as Record<
    FogProgramName,
    { layout: GPUBindGroupLayout; pipeline: ReturnType<typeof stage> }
  >
  for (const name of Object.keys(FOG_PROGRAMS) as FogProgramName[]) {
    const layout = device.createBindGroupLayout({ entries: layoutEntries(name) })
    const pipeline = stage(name, layout)
    pipeline.prepare().catch(failed)
    programs[name] = { layout, pipeline }
  }
  return programs
}

/** Bytes of the textures of `grid` (`createVolumeTextures`): three volumes, two planes. */
const volumeBytes = (grid: FogGrid) =>
  3 * grid.x * grid.y * grid.z * texelBytesOf(FOG_VOLUME_FORMAT) +
  2 * grid.x * grid.y * texelBytesOf('r32float')

/**
 * WHAT THE VOLUME'S PASSES ARE MADE OF, made once (`createFogVolumeGpu`): the frame's buffer, the
 * layout and the pipeline of each program — asked now, off the frame —, and the textures of the
 * grid, made again, the old ones retired, when the grid changes (`generation` counts the makings).
 * The textures are the device's budget's to refuse (`budgetRefused`): the volume is then built by
 * none, and asked again at the next image.
 */
export function createFogVolumeResources(device: GPUDevice, failed: (error: unknown) => void) {
  const frame = uniformBlock(device, 'Trillion3D fog frame', FOG_VOLUME_FRAME_WORDS * 4)
  const programs = createFogPrograms(device, failed)
  let textures: VolumeTextures | undefined
  let generation = 0
  return {
    /** The frame the passes read: its words, written each image, and its buffer, sent by what
     *  changed (`uniformBlock`). */
    frame,
    programs,
    /** The sampler the scatter reads the previous volume through (the one of the device). */
    sampler: createFogSampler(device),
    /** How many times the textures were made. */
    get generation() {
      return generation
    },
    /** Bytes the textures held take. */
    get bytes() {
      return textures ? volumeBytes(textures.grid) : 0
    },
    /** The textures of `grid`: the held ones where it is the same grid, else new ones — none where
     *  the device's budget refuses them. */
    texturesOf(grid: FogGrid) {
      if (textures && textures.grid === grid) return textures
      const replaced = textures ? volumeBytes(textures.grid) : 0
      if (textures) this.release()
      // The volume is an optional allocation, the analytic fog its fallback: made under the ledger's
      // tentative admission, the memory it replaces counted out (`ledgerAdmitted`).
      textures = ledgerAdmitted(device, {
        replaced,
        asked: volumeBytes(grid),
        what: 'the fog volume',
        make: () => createVolumeTextures(device, grid),
      }).value
      if (textures) generation++
      return textures
    },
    /** Retires the textures held: they may be named by this image's commands. */
    release() {
      if (!textures) return
      for (const t of [...textures.scattering, textures.integrated, ...textures.furthest])
        retire(device, t.made)
      textures = undefined
    },
    dispose() {
      this.release()
      frame.buffer.destroy()
    },
  }
}

/** What `createFogVolumeResources` made. */
export type FogVolumeResources = ReturnType<typeof createFogVolumeResources>
