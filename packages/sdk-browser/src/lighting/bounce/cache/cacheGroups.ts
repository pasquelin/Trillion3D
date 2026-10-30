import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries, wholeBuffer } from '../../../gpu/core/computeBindings.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import {
  surfaceHitCardsEntries,
  surfaceHitEntries,
  type SurfaceHitReads,
} from '../../surfaceCache/hitWgsl.ts'
import type { SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import {
  skyLightReadBindEntries,
  type SkyLightReadSet,
} from '../../../modules/sky/skyLight/read.ts'
import {
  CACHE_FILTER_BINDINGS,
  CACHE_FIXUP_BINDINGS,
  CACHE_LIT_BINDINGS,
  CACHE_SPLAT_BINDINGS,
  CACHE_TILES_BINDINGS,
  CACHE_TRACE_BINDINGS,
  CACHE_TRACED_HIT,
  CACHE_TRACED_SCENE,
  CACHE_TRACE_HIT,
  CACHE_TRACE_SKY_LIGHT,
} from './cacheBindings.ts'
import type { CacheHitLighting } from './cacheHitLit.ts'
import type { CacheKernels, TracedCacheKernels } from './cacheKernels.ts'
import {
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_PARAMS,
  RADIANCE_CACHE_TILE_LEVELS,
  type CacheTemp,
} from './cacheLayout.ts'
import type { CacheStorage, CacheTempStorage, TraceAtlas } from './cacheStorage.ts'

/** What the cache is wired to: the levels' uniform, the cell table, the frame's queue, the pool's slots. */
export interface CacheWiring {
  grid: GPUBuffer
  table: GPUTextureView
  queue: GPUBuffer
  slots: number
  /** The pool's slots (`POOL_SLOT`), which hold the offsets of the probes from their cells' places. */
  offsets: GPUBuffer
}

/** What an image queued for the cache: the arguments of the dispatches over the probes (the pool wrote them), what the trace reads — the
 *  lights, the sky light, the global field and the surface cache —, the image's eye, and the scene trace the rays may be cast through
 *  instead of the field, where the image made one. */
export interface Queued {
  args: GPUBuffer
  lights: GPUBuffer
  sky: SkyLightReadSet
  reads: SurfaceHitReads
  eye: ArrayLike<number>
  rays?: SceneRays
  /** What the hit lighting of the rays needs where the settings light the probes' hits where they stand; `null` where the settings do not (decided), `undefined` where the image could not decide (no information: the cache keeps its state). */
  hit?: CacheHitLighting | null
  /** The pre-exposure the maps' light is kept under: a change of it makes the maps again. */
  preExposure: number
  /** The block of probes the image's queue is laid in (`probeQueueShapeOf`), which the atlases of the frame follow, and whether the image is
   *  a full update. */
  queue: CacheTemp & { full: boolean }
}

/** The groups over a storage: those that name stable resources, made with it. */
export function cacheGroupsOf(
  device: GPUDevice,
  kernels: CacheKernels,
  wiring: CacheWiring,
  s: CacheStorage,
) {
  return {
    tiles: device.createBindGroup({
      layout: kernels.tiles.layout,
      entries: namedEntries(CACHE_TILES_BINDINGS, {
        grid: wholeBuffer(wiring.grid),
        table: wiring.table,
        queue: wholeBuffer(wiring.queue),
        params: wholeBuffer(s.params),
        tiles: wholeBuffer(s.tiles),
        pdf: wholeBuffer(s.pdf),
      }),
    }),
  }
}

/** A binder of one group: `identify` writes into `next` the identities of what `args` name, and `describe` makes the group's
 *  descriptor of them — made again only where an identity moved. */
function groupBinder<A extends unknown[]>(
  device: GPUDevice,
  identify: (next: unknown[], ...args: A) => void,
  describe: (...args: A) => GPUBindGroupDescriptor,
) {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (...args: A) => {
    identify(identity.next, ...args)
    if (identity.moved()) group = device.createBindGroup(describe(...args))
    return group!
  }
}

/** The bindings the filter and the fixup share: the grid, the table and the queue, the raw radiance, and the filtered one with its sky. */
function filterInputs(wiring: CacheWiring, s: CacheStorage, t: CacheTempStorage) {
  return {
    grid: wholeBuffer(wiring.grid),
    table: wiring.table,
    queue: wholeBuffer(wiring.queue),
    params: wholeBuffer(s.params),
    raw: s.views.raw,
    filtered: t.views.filtered,
    filteredSky: t.views.filteredSky,
  }
}

/** The filter's group over a storage, the frame's atlases and the blue noise it dithers by: made again only where one of them moved (the noise
 *  is made after the cache, and replaces the stand-in a pass binds until it is). */
export function cacheFilterBinder(device: GPUDevice, wiring: CacheWiring) {
  return groupBinder(
    device,
    (next, _: CacheKernels, s: CacheStorage, t: CacheTempStorage, noise: GPUTextureView) => {
      next[0] = s
      next[1] = t
      next[2] = noise
    },
    (kernels, s, t, noise) => ({
      layout: kernels.filter.layout,
      entries: namedEntries(CACHE_FILTER_BINDINGS, {
        ...filterInputs(wiring, s, t),
        noise,
        slots: wholeBuffer(wiring.offsets),
      }),
    }),
  )
}

/** The fixup's group over a storage and the frame's atlases: made again only where one of them moved. */
export function cacheFixupBinder(device: GPUDevice, wiring: CacheWiring) {
  return groupBinder(
    device,
    (next, _: CacheKernels, s: CacheStorage, t: CacheTempStorage) => {
      next[0] = s
      next[1] = t
    },
    (kernels, s, t) => ({
      layout: kernels.fixup.layout,
      entries: namedEntries(CACHE_FIXUP_BINDINGS, {
        ...filterInputs(wiring, s, t),
        final0: s.views.levels[0],
        final1: s.views.levels[1],
        final2: s.views.levels[2],
        sky: s.views.sky,
      }),
    }),
  )
}

/** The group of the spread of the trace atlas over a storage and the trace atlas: made again only where one of them moved. */
export function cacheSplatBinder(device: GPUDevice, wiring: CacheWiring) {
  return groupBinder(
    device,
    (next, _: CacheKernels, s: CacheStorage, atlas: TraceAtlas) => {
      next[0] = s
      next[1] = atlas
    },
    (kernels, s, atlas) => ({
      layout: kernels.splat.layout,
      entries: namedEntries(CACHE_SPLAT_BINDINGS, {
        grid: wholeBuffer(wiring.grid),
        table: wiring.table,
        queue: wholeBuffer(wiring.queue),
        params: wholeBuffer(s.params),
        tiles: wholeBuffer(s.tiles),
        trace: atlas.view,
        raw: s.views.raw,
      }),
    }),
  )
}

/** The first identities of a trace's group, the same for both ways of casting: the storage, the lights and the sky light. */
function traceKeys(next: unknown[], s: CacheStorage, q: Queued) {
  next[0] = s
  next[1] = q.lights
  next[2] = q.sky.cube
  next[3] = q.sky.harmonics
  next[4] = q.sky.params
}

/** The entries of a trace's group, the same for both ways of casting: the grid, the lights, the queue, the table, the tiles, the atlas
 *  written (`out`: the raw atlas, or the trace atlas), the parameters and the sky light. */
function traceEntries(
  wiring: CacheWiring,
  s: CacheStorage,
  q: Queued,
  out: GPUTextureView,
): GPUBindGroupEntry[] {
  return [
    ...namedEntries(CACHE_TRACE_BINDINGS, {
      grid: wholeBuffer(wiring.grid),
      lights: wholeBuffer(q.lights),
      queue: wholeBuffer(wiring.queue),
      table: wiring.table,
      tiles: wholeBuffer(s.tiles),
      raw: out,
      params: wholeBuffer(s.params),
    }),
    ...skyLightReadBindEntries(CACHE_TRACE_SKY_LIGHT, q.sky),
  ]
}

/** The trace's group over a storage and what an image queued: made again only where one of them moved. */
export function cacheTraceBinder(device: GPUDevice, wiring: CacheWiring) {
  return groupBinder(
    device,
    (next, _: CacheKernels, s: CacheStorage, q: Queued) => {
      traceKeys(next, s, q)
      next[5] = q.reads.field.readGeneration
      next[6] = q.reads.hit.tables
      next[7] = q.reads.hit.depth
      next[8] = q.reads.hit.final
      next[9] = q.reads.hit.grid
      next[10] = q.reads.hit.instances
    },
    (kernels, s, q) => ({
      layout: kernels.trace.layout,
      entries: [
        ...traceEntries(wiring, s, q, s.views.raw),
        ...surfaceHitEntries(CACHE_TRACE_HIT, q.reads.field, q.reads.hit),
      ],
    }),
  )
}

/** The entries of the own group of the trace through the scene's triangles: the texture the hits are marked in is named by the kernels that write it alone (`TracedCacheKernels.hitLit`), whatever atlas they are given. */
export function cacheTracedEntries(
  wiring: CacheWiring,
  kernels: Pick<TracedCacheKernels, 'hitLit'>,
  s: CacheStorage,
  q: Queued,
  rays: SceneRays,
  atlas: TraceAtlas,
): GPUBindGroupEntry[] {
  return [
    ...traceEntries(wiring, s, q, atlas.view),
    ...dagReadGroupEntries(rays.views),
    ...surfaceHitCardsEntries(CACHE_TRACED_HIT, q.reads.hit),
    ...(kernels.hitLit ? [{ binding: CACHE_LIT_BINDINGS.marks, resource: atlas.marks! }] : []),
  ]
}

/** The groups of the trace that casts its rays through the scene's triangles: its own over a storage, the trace atlas it writes and what an
 *  image queued, the scene trace's over the scene trace of the image — each made again only where a resource it names moved. */
export function cacheTracedBinder(device: GPUDevice, wiring: CacheWiring) {
  const sceneGroup = sceneTraceGroupBinder(device)
  const ownGroup = groupBinder(
    device,
    (
      next,
      kernels: TracedCacheKernels,
      s: CacheStorage,
      q: Queued,
      rays: SceneRays,
      atlas: TraceAtlas,
    ) => {
      traceKeys(next, s, q)
      next[13] = atlas
      next[14] = kernels.layouts[0]
      next[5] = q.reads.hit.tables
      next[6] = q.reads.hit.depth
      next[7] = q.reads.hit.final
      next[8] = q.reads.hit.instances
      next[9] = rays.views.nodes
      next[10] = rays.views.frames
      next[11] = rays.views.worlds
      next[12] = rays.views.tree
    },
    (kernels, s, q, rays, atlas) => ({
      layout: kernels.layouts[0],
      entries: cacheTracedEntries(wiring, kernels, s, q, rays, atlas),
    }),
  )
  return (
    kernels: TracedCacheKernels,
    s: CacheStorage,
    q: Queued,
    rays: SceneRays,
    atlas: TraceAtlas,
  ) =>
    [
      ownGroup(kernels, s, q, rays, atlas),
      sceneGroup(
        kernels.layouts[CACHE_TRACED_SCENE.group],
        rays.sceneTrace,
        CACHE_TRACED_SCENE.first,
      ),
    ] as const
}

/** What the cache's parameters say of the frame: the block of probes its atlases are laid out for, the tiles the trace atlas holds (`traceTiles`),
 *  whether its rays go through the trace atlas. */
export interface FrameShape {
  queue: CacheTemp
  traceTiles: number
  traced: boolean
  /** The mode word the rays' hits are lit with where the hit lighting runs (`cacheHitLightWord`), else zero. */
  lit: number
  /** The exposure the hit lighting's lights are strengthened under (`CacheHitLighting.exposure`), 1 where none runs. */
  litExposure: number
}

/** The words of the cache's parameters (`RADIANCE_CACHE_PARAMS`) for an image of `settings`, the eye at `eye`, the frame as `frame` says, and
 *  with what the rays cast through the scene's triangles (`rays`) are made with, set in `image`; nothing is allocated by a call. */
export function writeCacheParams(
  settings: ScreenProbeSettings,
  eye: ArrayLike<number>,
  image: ArrayBuffer,
  frame: FrameShape,
  rays?: SceneRays,
) {
  const P = RADIANCE_CACHE_PARAMS.at,
    { cache } = settings
  const { u: words, f: floats } = wordViews(image)
  words[P.resolution] = cache.resolution
  words[P.flags] =
    (cache.filter ? RADIANCE_CACHE_FLAGS.filter : 0) |
    (cache.skyVisibility ? RADIANCE_CACHE_FLAGS.sky : 0) |
    (frame.traced ? RADIANCE_CACHE_FLAGS.traced : 0) |
    (cache.calculatesIrradiance ? RADIANCE_CACHE_FLAGS.leak : 0)
  words[P.mipmaps] = cache.mipmaps
  words[P.tempRow] = frame.queue.row
  words[P.traceTiles] = frame.traceTiles
  words[P.lit] = frame.lit
  floats[P.litExposure] = frame.litExposure
  words[P.level] = RADIANCE_CACHE_TILE_LEVELS[cache.tiles]
  floats[P.downsampleSq] = cache.downsampleSq
  floats[P.supersampleSq] = cache.supersampleSq
  floats[P.tileThreshold] = cache.tileThreshold
  floats[P.filterAngle] = cache.filterAngle
  putVec4(floats, P.leak, ...cache.skylightLeak, cache.skylightLeakingRoughness)
  floats[P.leakDistance] = cache.skylightLeakingInverseDistance
  putVec4(floats, P.eye, eye[0], eye[1], eye[2])
  putVec4(
    floats,
    P.traced,
    settings.values.hardwareRayTracingPullbackBias,
    rays?.depthBias ?? 0,
    rays?.minHitDistance ?? 0,
  )
}
