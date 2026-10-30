import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import { constructGpuResources } from '../../../gpu/core/deviceLedger.ts'
import { createList } from '../../../gpu/dispatch/list.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import {
  CACHE_FIXUP_LEVELS,
  CACHE_PDF_WORDS,
  CACHE_TRACE_ATLAS_TILES,
  RADIANCE_CACHE_PARAMS_BYTES,
  cacheExtent,
  cacheFinalSide,
  cacheTempBytes,
  cacheTempExtent,
  CACHE_LIT_MARKS_FORMAT,
  cacheTileCapacity,
  cacheTraceBytes,
  cacheTraceExtent,
  radianceRawFormat,
  radianceCacheFormats,
  radianceCacheTempFormats,
  type CacheShape,
  type CacheTemp,
} from './cacheLayout.ts'

/** The atlases of the cache: the raw one, the final one with its border and levels of detail and the sky's share (a texel where it is not
 *  kept), and, for the levels of detail the final atlas does not hold, a texel each that the fixup's kernel writes to. */
function cacheAtlases(device: GPUDevice, shape: CacheShape, slots: number) {
  const { resolution, mipmaps, skyVisibility } = shape
  const F = radianceCacheFormats(shape.light)
  const size = cacheExtent(resolution, slots)
  const finalSize = cacheExtent(cacheFinalSide(resolution, mipmaps), slots)
  const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
  const atlas = (
    label: string,
    extent: [number, number],
    format: GPUTextureFormat,
    mips = 1,
    extra = 0,
  ) =>
    device.createTexture({
      label: `Trillion3D radiance cache ${label} v1`,
      size: extent,
      format,
      mipLevelCount: mips,
      usage: usage | extra,
    })
  const raw = atlas('raw', size, F.raw)
  // The final maps and the sky's share are copied to, to be set to black (`clearCacheMaps`).
  const final = atlas('final', finalSize, F.final, mipmaps, GPUTextureUsage.COPY_DST)
  const sky = atlas('sky', skyVisibility ? finalSize : [1, 1], F.sky, 1, GPUTextureUsage.COPY_DST)
  const spare = Array.from({ length: CACHE_FIXUP_LEVELS - mipmaps }, () =>
    atlas('spare', [1, 1], F.final),
  )
  const read = {
    raw: raw.createView(),
    final: final.createView(),
    sky: sky.createView(),
    light: shape.light,
  }
  return {
    raw,
    final,
    sky,
    spare,
    /** The views the screen probes read the maps by: the raw atlas's, the final atlas's with its levels of detail, the sky's share, and the format the final atlas holds the light in. */
    read,
    views: {
      ...read,
      /** The levels of detail of the final maps, each alone, as the fixup's kernel writes them: the levels the atlas holds, then a texel each
       *  for the levels it does not. */
      levels: [
        ...Array.from({ length: mipmaps }, (_, level) =>
          final.createView({ baseMipLevel: level, mipLevelCount: 1 }),
        ),
        ...spare.map((texture) => texture.createView()),
      ],
    },
  }
}

/** What the radiance cache keeps for maps of the shape `shape` in a pool of `slots` probes: the raw and the final atlases — the final
 *  one with its border and levels of detail, each a view of its own to be written —, the sky's share atlas where the sky is kept apart (a
 *  texel else), the list of the trace tiles, the sums of the lobes the screen probes want light in (`pdf`, which the screen probes add to
 *  and the trace tiles follow) and the parameters. */
export function createCacheStorage(device: GPUDevice, shape: CacheShape, slots: number) {
  return constructGpuResources(device, () => {
    const atlases = cacheAtlases(device, shape, slots)
    const pdf = device.createBuffer({
      label: 'Trillion3D radiance cache lobes v1',
      size: slots * CACHE_PDF_WORDS * 4,
      usage: GPUBufferUsage.STORAGE,
    })
    return {
      shape,
      ...atlases,
      pdf,
      read: { ...atlases.read, pdf },
      views: { ...atlases.views, pdf },
      tiles: createList(
        device,
        'Trillion3D radiance cache tiles v1',
        cacheTileCapacity(shape.resolution, slots),
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
export function destroyCacheStorage({ raw, final, sky, spare, tiles, pdf, params }: CacheStorage) {
  for (const resource of [raw, final, sky, ...spare, tiles, pdf, params]) resource.destroy()
}

/** The atlases a frame keeps for the queue's block of probes `temp` (`cacheTempExtent`): the filter's light, and its sky's share where the
 *  sky is kept apart (a texel else). */
export function createCacheTemp(device: GPUDevice, shape: CacheShape, temp: CacheTemp) {
  const size = cacheTempExtent(shape.resolution, temp)
  const T = radianceCacheTempFormats(shape.light)
  const atlas = (label: string, extent: [number, number], format: GPUTextureFormat) =>
    device.createTexture({
      label: `Trillion3D radiance cache ${label} v1`,
      size: extent,
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  const filtered = atlas('filtered', size, T.filtered)
  const filteredSky = atlas('filtered sky', shape.skyVisibility ? size : [1, 1], T.filteredSky)
  return {
    shape,
    /** The extent of the atlases, which a block of probes of no greater extent (`cacheTempExtent`) is laid out in. */
    extent: size,
    bytes: cacheTempBytes(shape, temp),
    filtered,
    filteredSky,
    views: { filtered: filtered.createView(), filteredSky: filteredSky.createView() },
    destroy() {
      filtered.destroy()
      filteredSky.destroy()
    },
  }
}

/** The frame's atlases, made. */
export type CacheTempStorage = ReturnType<typeof createCacheTemp>

/** The trace atlas for `tiles` tiles: the rays of the trace through the scene's triangles, in the order of the tile list, their light stored in `light`; with `marked` the texture the trace marks its hits in, for the hit lighting, laid out as the atlas is. */
export function createTraceAtlas(
  device: GPUDevice,
  tiles: number,
  light: LightAtlasFormat,
  marked = false,
) {
  const texture = device.createTexture({
    label: 'Trillion3D radiance cache trace v1',
    size: cacheTraceExtent(tiles),
    format: radianceRawFormat(light),
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const marks = marked
    ? device.createTexture({
        label: 'Trillion3D radiance cache trace marks',
        size: cacheTraceExtent(tiles),
        format: CACHE_LIT_MARKS_FORMAT,
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
    : undefined
  // What the atlas holds: whole rows of tiles, so an update asking a few more tiles within the last row keeps it.
  const capacity = Math.max(1, ceilDiv(tiles, CACHE_TRACE_ATLAS_TILES)) * CACHE_TRACE_ATLAS_TILES
  return {
    tiles: capacity,
    bytes: cacheTraceBytes(capacity, light, marked),
    texture,
    view: texture.createView(),
    /** The view of the texture the hits are marked in, none where the atlas holds no hit lighting. */
    marks: marks?.createView(),
    destroy: () => (texture.destroy(), marks?.destroy()),
  }
}

/** The trace atlas, made. */
export type TraceAtlas = ReturnType<typeof createTraceAtlas>
