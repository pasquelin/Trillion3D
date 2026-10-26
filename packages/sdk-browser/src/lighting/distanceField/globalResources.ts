import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import {
  clipmapMipResolution,
  numClipmaps,
  pageAtlasSizeInPages,
  pageTableClipmapResolution,
  GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS as COVERAGE_IN_ATLAS,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS as MAX,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_BYTES as GRID_PAGE_BYTES,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS as IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { hasTextureFormatsTier2 } from '../../gpu/core/textureFormatsTier.ts'
import { ARGS_WORDS, CLIP_BLOCK_BYTES, CONTROL } from './clipmapBlock.ts'
import { clipmapSizes } from './clipmapUniforms.ts'
import { OBJECT_COUNTS } from './cullWgsl.ts'
import { MIP_BLOCK_BYTES } from './mipWgsl.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S RESOURCES: the page tables of the static meshes and of all, the table
 * the programs read, the page atlas, the coarse mip and the volume beside it, the lists the
 * update keeps, and the blocks it is given. They are sized by the settings (the clipmaps, the
 * resolution, the occupancy ratio, the mip factor, the culling grid's room) and made again when
 * those change, the field then composited whole; the culled objects' list grows with the scene.
 *
 * The page atlas is a 3D texture of bytes where the device reads and writes the format in a
 * compute pass (`../../gpu/core/textureFormatsTier.ts`), 128 pages wide and as wide again, a layer
 * of pages 8 voxels deep (`atlasTexture`); else a buffer of them (`atlas`); the one it does not
 * keep is a stand-in of one texel or word, bound beside it for what reads either. While rays are
 * marched through the field (`traced`) it keeps the coverage atlas, 4 × 4 × 4 bytes a page, in the
 * buffer `atlas` past the pages' bytes (`coverageBase`); and, while a pass reads the object grid (`grid`:
 * the surface cache is asked for), the object grid, 4 × 4 × 4 cells of 16 bytes a page, held to what the
 * device binds. The pages the atlas buffer holds are held to what the device binds too: a field whose
 * settings ask for more has the room the device gives, the allocator's.
 */

/** The regions a clipmap may name to be composited again at most: 1023 reached, three slabs, and as
 *  many inherited from the static clipmap. */
export const UPDATE_BOUND_CAPACITY = 2 * 1024 + 8
const BOUND_BYTES = 32

/** What decides the shape of the resources: the settings', whether rays are marched through the field
 *  (`traced`: its pages keep a coverage atlas) and whether a pass reads the object grid (`grid`), a field
 *  composited without them being made again to hold them. */
export function resourceShape(
  settings: GlobalDistanceFieldSettings,
  traced: boolean,
  grid: boolean,
) {
  const clipmaps = numClipmaps(settings)
  const [, , layers] = pageAtlasSizeInPages(settings, clipmaps)
  return [
    clipmaps,
    pageTableClipmapResolution(settings),
    layers,
    clipmapMipResolution(settings),
    settings.globalDistanceFieldAverageCulledObjectsPerCell,
    settings.globalDistanceFieldCacheMostlyStaticSeparately,
    traced,
    grid,
  ].join(' ')
}

const volume = (
  device: GPUDevice,
  label: string,
  size: readonly number[],
  format: GPUTextureFormat,
) =>
  device.createTexture({
    label,
    dimension: '3d',
    size: { width: size[0], height: size[1], depthOrArrayLayers: size[2] },
    format,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })

const storage = (device: GPUDevice, label: string, bytes: number, extra = 0) =>
  device.createBuffer({
    label,
    size: Math.max(16, bytes),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra,
  })

/** Records a resource of the field to be destroyed with it. */
type Keep = <T extends { destroy(): void }>(resource: T) => T

/** The page tables of the static meshes and of all, and the stand-ins beside them. */
function pageTablesOf(
  device: GPUDevice,
  keep: Keep,
  table: readonly [number, number, number],
  separately: boolean,
) {
  return {
    static: keep(volume(device, 'Trillion3D global distance field static pages', table, 'r32uint')),
    full: keep(volume(device, 'Trillion3D global distance field pages', table, 'r32uint')),
    combined: separately
      ? keep(volume(device, 'Trillion3D global distance field combined pages', table, 'r32uint'))
      : undefined,
    unusedWrite: keep(
      volume(device, 'Trillion3D global distance field unused table', [1, 1, 1], 'r32uint'),
    ),
    unusedRead: keep(
      volume(device, 'Trillion3D global distance field unused table, read', [1, 1, 1], 'r32uint'),
    ),
  }
}

/** The page atlas, as the texture or the buffer, and its sampler. */
function pageAtlasOf(
  device: GPUDevice,
  keep: Keep,
  atlas: Pick<ReturnType<typeof sizingOf>, 'textured' | 'atlasSize' | 'maxPages' | 'pageBytes'>,
) {
  const { textured, atlasSize, maxPages, pageBytes } = atlas
  const [atlasX, atlasY, layers] = atlasSize
  return {
    /** The buffer: the page atlas's bytes where it is not a texture, the coverage atlas past them. */
    atlas: keep(
      storage(device, 'Trillion3D global distance field page atlas', maxPages * pageBytes),
    ),
    /** The word of the buffer the coverage atlas begins at. */
    coverageBase: textured ? 0 : (maxPages * IN_ATLAS ** 3) / 4,
    atlasTexture: keep(
      device.createTexture({
        label: 'Trillion3D global distance field page atlas, texture',
        dimension: '3d',
        size: textured
          ? {
              width: atlasX * IN_ATLAS,
              height: atlasY * IN_ATLAS,
              depthOrArrayLayers: layers * IN_ATLAS,
            }
          : [1, 1, 1],
        format: 'r8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | (textured ? GPUTextureUsage.STORAGE_BINDING : 0),
      }),
    ),
    atlasSampler: device.createSampler({
      label: 'Trillion3D global distance field page atlas, sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      addressModeW: 'repeat',
    }),
  }
}

/** The lists the update keeps and the regions it composites. */
function updateListsOf(
  device: GPUDevice,
  keep: Keep,
  maxPages: number,
  sizes: ReturnType<typeof clipmapSizes>,
) {
  return {
    lists: keep(storage(device, 'Trillion3D global distance field page lists', 2 * maxPages * 4)),
    control: keep(storage(device, 'Trillion3D global distance field control', CONTROL.words * 4)),
    args: keep(
      storage(
        device,
        'Trillion3D global distance field arguments',
        MAX * ARGS_WORDS * 4,
        GPUBufferUsage.INDIRECT,
      ),
    ),
    /** The arguments of the return of the free pages, apart from the others: its pass binds the
     *  arguments it is dispatched by. */
    returnArgs: keep(
      storage(
        device,
        'Trillion3D global distance field return arguments',
        ARGS_WORDS * 4,
        GPUBufferUsage.INDIRECT,
      ),
    ),
    tiles: keep(storage(device, 'Trillion3D global distance field tiles', MAX * sizes.tiles * 4)),
    cull: keep(
      storage(device, 'Trillion3D global distance field culling grids', MAX * sizes.cull * 4),
    ),
    bounds: keep(
      storage(
        device,
        'Trillion3D global distance field regions',
        2 * MAX * UPDATE_BOUND_CAPACITY * BOUND_BYTES,
      ),
    ),
    packed: keep(storage(device, 'Trillion3D global distance field clipmaps', 2 * MAX * 3 * 16)),
  }
}

/** The uniform blocks the update is given. */
function blocksOf(device: GPUDevice, keep: Keep) {
  const block = (label: string, bytes: number) =>
    keep(
      device.createBuffer({
        label,
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    )
  return {
    blocks: block('Trillion3D global distance field blocks', 2 * MAX * CLIP_BLOCK_BYTES),
    cullBlocks: block('Trillion3D global distance field culling blocks', 2 * CLIP_BLOCK_BYTES),
    mipBlocks: block('Trillion3D global distance field mip blocks', 2 * MAX * MIP_BLOCK_BYTES),
  }
}

/** The sizes of the resources of the settings, on `device`: the tables and the mip, the atlas and the pages it holds. */
function sizingOf(device: GPUDevice, settings: GlobalDistanceFieldSettings, traced: boolean) {
  const clipmaps = numClipmaps(settings)
  const pages = pageTableClipmapResolution(settings)
  const table = [pages, pages, pages * Math.max(1, clipmaps)] as const
  const atlasSize = pageAtlasSizeInPages(settings, clipmaps)
  const textured = hasTextureFormatsTier2(device)
  const limit = storageBufferCap(device.limits)
  // The pages' bytes where the atlas is not a texture, then the coverage atlas while rays are marched: one
  // buffer, so one binding, so no more pages than the device binds.
  const pageBytes = (textured ? 0 : IN_ATLAS ** 3) + (traced ? COVERAGE_IN_ATLAS ** 2 * 4 : 0)
  const maxPages = Math.min(
    atlasSize[0] * atlasSize[1] * atlasSize[2],
    Math.floor(limit / Math.max(1, pageBytes)),
  )
  const mip = clipmapMipResolution(settings)
  const mipSize = [mip, mip, mip * Math.max(1, clipmaps)] as const
  const sizes = clipmapSizes(settings)
  // The object grid, held to what the device binds too, which a field no pass reads it of goes without.
  const gridBytes = Math.min(maxPages, Math.floor(limit / GRID_PAGE_BYTES)) * GRID_PAGE_BYTES
  return {
    clipmaps,
    pages,
    table,
    atlasSize,
    textured,
    pageBytes,
    maxPages,
    gridBytes,
    mipSize,
    sizes,
  }
}

/** The resources of one shape. */
export function createGlobalResources(
  device: GPUDevice,
  settings: GlobalDistanceFieldSettings,
  traced: boolean,
  grid: boolean,
) {
  const sizing = sizingOf(device, settings, traced)
  const { clipmaps, pages, table, textured, maxPages, gridBytes, mipSize, sizes } = sizing
  const separately = settings.globalDistanceFieldCacheMostlyStaticSeparately
  const made: { destroy(): void }[] = []
  const keep: Keep = (resource) => (made.push(resource), resource)
  const tables = pageTablesOf(device, keep, table, separately)
  const atlas = pageAtlasOf(device, keep, sizing)
  const blocks = blocksOf(device, keep)
  const idle = keep(storage(device, 'Trillion3D global distance field unused buffer', 16))
  return {
    shape: resourceShape(settings, traced, grid),
    clipmaps,
    pages,
    maxPages,
    sizes,
    tables,
    /** The table the programs read. */
    read: separately ? tables.combined! : tables.full,
    /** Whether the page atlas is the texture, else the buffer. */
    textured,
    ...atlas,
    /** The object grid. */
    objectGrid: grid
      ? keep(storage(device, 'Trillion3D global distance field object grid', gridBytes))
      : idle,
    mip: keep(volume(device, 'Trillion3D global distance field mips', mipSize, 'r32float')),
    mipTemp: keep(
      volume(device, 'Trillion3D global distance field mip steps', mipSize, 'r32float'),
    ),
    ...updateListsOf(device, keep, maxPages, sizes),
    idle,
    ...blocks,
    /** The list of culled objects, made at the size of the scene. */
    objects: undefined as GPUBuffer | undefined,
    objectStride: 0,
    /** Room for the culled objects of `count` placements for each clipmap. */
    ensureObjects(count: number) {
      const stride = nextPow2(Math.max(1, count))
      if (this.objects && this.objectStride >= stride) return
      if (this.objects) retire(device, this.objects)
      this.objectStride = stride
      this.objects = storage(
        device,
        'Trillion3D global distance field culled objects',
        (OBJECT_COUNTS + MAX * stride) * 4,
      )
    },
    dispose() {
      made.forEach((resource) => resource.destroy())
      this.objects?.destroy()
    },
  }
}

export type GlobalResources = ReturnType<typeof createGlobalResources>
