import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import {
  clipmapMipResolution,
  numClipmaps,
  pageAtlasSizeInPages,
  pageTableClipmapResolution,
  GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS as MAX,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS as IN_ATLAS,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
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
 */

/** The regions a clipmap may name to be composited again at most: 1023 reached, three slabs, and as
 *  many inherited from the static clipmap. */
export const UPDATE_BOUND_CAPACITY = 2 * 1024 + 8
const BOUND_BYTES = 32

/** What decides the shape of the resources. */
export function resourceShape(settings: GlobalDistanceFieldSettings) {
  const clipmaps = numClipmaps(settings)
  const [, , layers] = pageAtlasSizeInPages(settings, clipmaps)
  return [
    clipmaps,
    pageTableClipmapResolution(settings),
    layers,
    clipmapMipResolution(settings),
    settings.globalDistanceFieldAverageCulledObjectsPerCell,
    settings.globalDistanceFieldCacheMostlyStaticSeparately,
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

/** The resources of one shape. */
export function createGlobalResources(device: GPUDevice, settings: GlobalDistanceFieldSettings) {
  const clipmaps = numClipmaps(settings)
  const pages = pageTableClipmapResolution(settings)
  const table = [pages, pages, pages * Math.max(1, clipmaps)] as const
  const [atlasX, atlasY, layers] = pageAtlasSizeInPages(settings, clipmaps)
  const maxPages = atlasX * atlasY * layers
  const mip = clipmapMipResolution(settings)
  const mipSize = [mip, mip, mip * Math.max(1, clipmaps)] as const
  const sizes = clipmapSizes(settings)
  const separately = settings.globalDistanceFieldCacheMostlyStaticSeparately
  const made: { destroy(): void }[] = []
  const keep = <T extends { destroy(): void }>(resource: T) => (made.push(resource), resource)
  const tables = {
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
  const block = (label: string, bytes: number) =>
    keep(
      device.createBuffer({
        label,
        size: bytes,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    )
  return {
    shape: resourceShape(settings),
    clipmaps,
    pages,
    maxPages,
    sizes,
    tables,
    /** The table the programs read. */
    read: separately ? tables.combined! : tables.full,
    atlas: keep(
      storage(device, 'Trillion3D global distance field page atlas', maxPages * IN_ATLAS ** 3),
    ),
    mip: keep(volume(device, 'Trillion3D global distance field mips', mipSize, 'r32float')),
    mipTemp: keep(
      volume(device, 'Trillion3D global distance field mip steps', mipSize, 'r32float'),
    ),
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
    idle: keep(storage(device, 'Trillion3D global distance field unused buffer', 16)),
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
    blocks: block('Trillion3D global distance field blocks', 2 * MAX * CLIP_BLOCK_BYTES),
    cullBlocks: block('Trillion3D global distance field culling blocks', 2 * CLIP_BLOCK_BYTES),
    mipBlocks: block('Trillion3D global distance field mip blocks', 2 * MAX * MIP_BLOCK_BYTES),
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
