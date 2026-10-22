import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import {
  budgetRefused,
  ledgerReplacing,
  ledgerRoom,
  ledgerTentative,
} from '../../gpu/core/deviceLedger.ts'
import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { standInTexture } from '../../gpu/core/standInTexture.ts'
import { FOG_STATIC_FORMAT, FOG_VOLUME_FRAME_WORDS, type FogGrid } from './layout.ts'
import { type FogProgramName } from './bindings.ts'
import { layoutEntries } from './layoutEntries.ts'
import { FOG_PROGRAMS } from './programs.ts'
import { createFogSampler, FOG_VOLUME_FORMAT } from './read.ts'

/** The entry points of the programs. */
const ENTRY_POINT = {
  furthest: 'furthestMain',
  scatter: 'scatterMain',
  scatterSky: 'scatterMain',
  static: 'staticMain',
  integrate: 'integrateMain',
  prepare: 'prepareMain',
  voxelize: 'voxelizeMain',
} as const satisfies Record<FogProgramName, string>

/** The textures of one grid: the volume of the scatter twice — this image's, the previous —, the
 *  integrated volume, and the furthest depth twice; where `voxels` holds, the two volumes the
 *  objects of the volume material domain are voxelised into (their scattering with the extinction,
 *  their emissive light); where `baked` holds, the volume of the static term's pass (`FOG_STATIC_FORMAT`). A 3D texture of half floats, the grid's cells; a 2D one of floats, its
 *  cells across the image. */
function createVolumeTextures(device: GPUDevice, grid: FogGrid, voxels: boolean, baked: boolean) {
  const made: GPUTexture[] = []
  const make = (descriptor: GPUTextureDescriptor) => {
    const texture = device.createTexture(descriptor)
    made.push(texture)
    return { made: texture, view: texture.createView() }
  }
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const volume = (label: string, format: GPUTextureFormat = FOG_VOLUME_FORMAT) =>
    make({
      label,
      dimension: '3d',
      size: { width: grid.x, height: grid.y, depthOrArrayLayers: grid.z },
      format,
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
      voxel: voxels
        ? ([
            volume('Trillion3D fog voxel medium'),
            volume('Trillion3D fog voxel emissive'),
          ] as const)
        : undefined,
      baked: baked ? volume('Trillion3D fog static term', FOG_STATIC_FORMAT) : undefined,
    }
  } catch (error) {
    // A refusal midway leaves nothing behind.
    for (const texture of made) texture.destroy()
    throw error
  }
}

/** The textures of a grid (`createVolumeTextures`). */
export type VolumeTextures = ReturnType<typeof createVolumeTextures>

/** A program of the volume: its layout and its pipeline. */
interface FogProgram {
  layout: GPUBindGroupLayout
  pipeline: ReturnType<ReturnType<typeof preparedComputeStage>['ask']>
}

/** The layout and the pipeline of each program but the sky scatter, the pipelines asked now, off the frame; and the
 *  sky scatter, whose pipeline is asked at the first image that wants it (`skyScatter`). */
function createFogPrograms(device: GPUDevice, failed: (error: unknown) => void) {
  const program = (name: FogProgramName): FogProgram => {
    const label = `Trillion3D fog ${name}`
    const layout = device.createBindGroupLayout({ entries: layoutEntries(name) })
    const module = device.createShaderModule({ label, code: FOG_PROGRAMS[name] })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] })
    const pipeline = preparedComputeStage(
      device,
      pipelineLayout,
      module,
      ENTRY_POINT[name],
      undefined,
      label,
    ).ask()
    pipeline.prepare().catch(failed)
    return { layout, pipeline }
  }
  const programs = {} as Record<Exclude<FogProgramName, 'scatterSky'>, FogProgram>
  for (const name of Object.keys(FOG_PROGRAMS) as FogProgramName[])
    if (name !== 'scatterSky') programs[name] = program(name)
  let sky: FogProgram | undefined
  return { programs, skyScatter: () => (sky ??= program('scatterSky')) }
}

/** Bytes of the textures of `grid` (`createVolumeTextures`): three volumes, two planes, two volumes
 *  more where the objects are voxelised, and the static term's where it is baked. */
const volumeBytes = (grid: FogGrid, voxels = false, baked = false) =>
  (voxels ? 5 : 3) * grid.x * grid.y * grid.z * texelBytesOf(FOG_VOLUME_FORMAT) +
  2 * grid.x * grid.y * texelBytesOf('r32float') +
  (baked ? grid.x * grid.y * grid.z * texelBytesOf(FOG_STATIC_FORMAT) : 0)

/** Bytes the textures held take. */
const bytesOf = (held: VolumeTextures) => volumeBytes(held.grid, !!held.voxel, !!held.baked)

/** Every texture of `held`. */
const allOf = (held: VolumeTextures) => [
  ...held.scattering,
  held.integrated,
  ...held.furthest,
  ...(held.voxel ?? []),
  ...(held.baked ? [held.baked] : []),
]

/** Whether `held` are the textures of `grid` and hold the voxelised objects' volumes where `voxels`
 *  asks for them, the static term's where `baked` does. */
const holds = (held: VolumeTextures | undefined, grid: FogGrid, voxels: boolean, baked: boolean) =>
  !!held && held.grid === grid && !!(held.voxel || !voxels) && !!(held.baked || !baked)

/** The static term's volume of an image that has no such pass: one cell the scatter does not read (the
 *  frame says so). */
function createBakedStandIn(device: GPUDevice) {
  const texture = standInTexture(device, 'Trillion3D fog no static term', FOG_STATIC_FORMAT, {
    dimension: '3d',
    storage: true,
  })
  return { texture, view: texture.createView({ dimension: '3d' }) }
}

/**
 * WHAT THE VOLUME'S PASSES ARE MADE OF, made once (`createFogVolumeGpu`): the frame's buffer, the
 * layout and the pipeline of each program — asked now, off the frame —, and the textures of the
 * grid, made again, the old ones retired, when the grid changes (`generation` counts the makings).
 * The textures are the device's budget's to refuse (`budgetRefused`): the volume is then built by
 * none, and asked again at the next image.
 */
export function createFogVolumeResources(device: GPUDevice, failed: (error: unknown) => void) {
  const frameBuffer = device.createBuffer({
    label: 'Trillion3D fog frame',
    size: FOG_VOLUME_FRAME_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const { programs, skyScatter } = createFogPrograms(device, failed)
  let textures: VolumeTextures | undefined
  let generation = 0
  let standIn: ReturnType<typeof createBakedStandIn> | undefined
  return {
    frameBuffer,
    programs,
    /** The scatter that finds the sky's visibility of each sample in the global distance field, its pipeline asked at the
     *  first call: the plain scatter serves until it is `ready`. */
    skyScatter,
    /** The sampler the scatter reads the previous volume and the cubemap through. */
    sampler: createFogSampler(device),
    /** How many times the textures were made. */
    get generation() {
      return generation
    },
    /** Bytes the textures held take. */
    get bytes() {
      return textures ? bytesOf(textures) : 0
    },
    /** The static term's volume of an image that has no such pass, made at the first call. */
    get bakedStandIn() {
      return (standIn ??= createBakedStandIn(device)).view
    },
    /** The textures of `grid`: the held ones where it is the same grid — and, where `voxels` asks
     *  for the voxelised objects' volumes or `baked` for the static term's, they are among them —,
     *  else new ones, with those volumes too if the held ones had them — none where the device's
     *  budget refuses them. */
    texturesOf(grid: FogGrid, voxels = false, baked = false) {
      if (textures && holds(textures, grid, voxels, baked)) return textures
      const keptVoxels = voxels || !!textures?.voxel
      const keptBaked = baked || !!textures?.baked
      const replaced = textures ? bytesOf(textures) : 0
      if (textures) this.release()
      // The volume is an optional allocation, the analytic fog its fallback: made under the ledger's
      // tentative admission, the memory it replaces counted out (`ledgerReplacing`).
      if (volumeBytes(grid, keptVoxels, keptBaked) - replaced > ledgerRoom(device)) return undefined
      try {
        textures = ledgerTentative(device, () =>
          ledgerReplacing(device, replaced, () =>
            createVolumeTextures(device, grid, keptVoxels, keptBaked),
          ),
        )
      } catch (error) {
        if (!budgetRefused(error)) throw error
        return undefined
      }
      generation++
      return textures
    },
    /** Retires the textures held: they may be named by this image's commands. */
    release() {
      if (!textures) return
      for (const t of allOf(textures)) retire(device, t.made)
      textures = undefined
    },
    dispose() {
      this.release()
      frameBuffer.destroy()
      standIn?.texture.destroy()
    },
  }
}

/** What `createFogVolumeResources` made. */
export type FogVolumeResources = ReturnType<typeof createFogVolumeResources>
