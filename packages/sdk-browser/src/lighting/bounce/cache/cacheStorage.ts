import { constructGpuResources } from '../../../gpu/core/errorScope.ts'
import { createList } from '../../../gpu/dispatch/list.ts'
import { BOUNCE_PROBE_QUEUE } from '../../../../../sdk-core/src/bounce/contracts.ts'
import {
  CACHE_PDF_WORDS,
  CACHE_TAG_WORDS,
  RADIANCE_CACHE_FORMATS as F,
  RADIANCE_CACHE_PARAMS_BYTES,
  cacheExtent,
  cacheTileCapacity,
  type CacheShape,
} from './cacheLayout.ts'

/** The atlases of the cache: the raw one, the final one with its levels of detail and the sky's share (a texel where it is not kept). */
function cacheAtlases(device: GPUDevice, shape: CacheShape, slots: number) {
  const { resolution, mipmaps, skyVisibility } = shape
  const size = cacheExtent(resolution, slots)
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const atlas = (label: string, extent: [number, number], format: GPUTextureFormat, mips = 1) =>
    device.createTexture({
      label: `Trillion3D radiance cache ${label} v1`,
      size: extent,
      format,
      mipLevelCount: mips,
      usage,
    })
  const raw = atlas('raw', size, F.raw)
  const final = atlas('final', size, F.final, mipmaps)
  const sky = atlas('sky', skyVisibility ? size : [1, 1], F.sky)
  return {
    raw,
    final,
    sky,
    views: {
      raw: raw.createView(),
      final: final.createView(),
      sky: sky.createView(),
      /** The levels of detail of the final maps, each alone: written, then read by the next. */
      levels: Array.from({ length: mipmaps }, (_, level) =>
        final.createView({ baseMipLevel: level, mipLevelCount: 1 }),
      ),
    },
  }
}

/** What the radiance cache keeps for maps of the shape `shape` in a pool of `slots` probes: the raw and the final atlases — the final
 *  one with its levels of detail, each a view of its own to be written —, the sky's share atlas where the sky is kept apart (a texel
 *  else), the tags of the final maps and the importance functions of the probes — a buffer a slot, zero: no map was made, no screen
 *  probe has read it —, the flags of the probes traced this frame, the list of the trace tiles and the parameters. */
export function createCacheStorage(device: GPUDevice, shape: CacheShape, slots: number) {
  return constructGpuResources(device, () => {
    const buffer = (label: string, words: number) =>
      device.createBuffer({
        label: `Trillion3D radiance cache ${label} v1`,
        size: Math.max(16, words * 4),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      })
    return {
      shape,
      ...cacheAtlases(device, shape, slots),
      tags: buffer('tags', slots * CACHE_TAG_WORDS),
      pdf: buffer('importance', slots * CACHE_PDF_WORDS),
      entries: buffer('traced', BOUNCE_PROBE_QUEUE),
      tiles: createList(
        device,
        'Trillion3D radiance cache tiles v1',
        cacheTileCapacity(shape.resolution),
        2,
      ),
      params: device.createBuffer({
        label: 'Trillion3D radiance cache parameters v1',
        size: RADIANCE_CACHE_PARAMS_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    }
  })
}

/** The storage of a cache, made. */
export type CacheStorage = ReturnType<typeof createCacheStorage>

/** Destroys every resource of `storage`. */
export function destroyCacheStorage({
  raw,
  final,
  sky,
  tags,
  pdf,
  entries,
  tiles,
  params,
}: CacheStorage) {
  for (const resource of [raw, final, sky, tags, pdf, entries, tiles, params]) resource.destroy()
}
