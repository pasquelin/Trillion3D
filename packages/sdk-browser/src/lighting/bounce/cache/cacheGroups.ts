import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import type { ProxyResources } from '../../../geometry/dag/cut/cutReaders.ts'
import { PROBE_PROXY } from '../probes/probeBindings.ts'
import { sceneBindEntries } from '../sceneBindings.ts'
import {
  CACHE_FILTER_BINDINGS,
  CACHE_MIPS_BINDINGS,
  CACHE_TILES_BINDINGS,
  CACHE_TRACE_BINDINGS,
} from './cacheBindings.ts'
import type { CacheKernels } from './cacheKernels.ts'
import {
  RADIANCE_CACHE_FLAGS,
  RADIANCE_CACHE_PARAMS,
  RADIANCE_CACHE_TILE_MODES,
} from './cacheLayout.ts'
import type { CacheStorage } from './cacheStorage.ts'

/** What the cache is wired to: the levels' uniform, the probes' atlas, the frame's queue, the pool's slots. */
export interface CacheWiring {
  grid: GPUBuffer
  probes: GPUTextureView
  queue: GPUBuffer
  slots: number
}

/** What an image queued for the cache: the probes, what the trace reads, the image's eye. */
export interface Queued {
  groups: number
  proxy: ProxyResources
  lights: GPUBuffer
  lists: GPUBuffer
  eye: ArrayLike<number>
}

/** The groups over a storage: those that name stable resources, made with it. */
export function cacheGroupsOf(
  device: GPUDevice,
  kernels: CacheKernels,
  wiring: CacheWiring,
  s: CacheStorage,
) {
  const T = CACHE_TILES_BINDINGS,
    F = CACHE_FILTER_BINDINGS,
    M = CACHE_MIPS_BINDINGS
  /** The first four bindings every kernel but the trace shares: the levels' uniform, the probes' atlas, the queue, the parameters. */
  const common = [
    { binding: 0, resource: { buffer: wiring.grid } },
    { binding: 1, resource: wiring.probes },
    { binding: 2, resource: { buffer: wiring.queue } },
    { binding: 3, resource: { buffer: s.params } },
  ]
  return {
    tiles: device.createBindGroup({
      layout: kernels.tiles.layout,
      entries: [
        ...common,
        { binding: T.pdf, resource: { buffer: s.pdf } },
        { binding: T.tiles, resource: { buffer: s.tiles } },
        { binding: T.entries, resource: { buffer: s.entries } },
      ],
    }),
    filter: device.createBindGroup({
      layout: kernels.filter.layout,
      entries: [
        ...common,
        { binding: F.entries, resource: { buffer: s.entries } },
        { binding: F.raw, resource: s.views.raw },
        { binding: F.final, resource: s.views.levels[0] },
        { binding: F.tags, resource: { buffer: s.tags } },
        { binding: F.sky, resource: s.views.sky },
      ],
    }),
    /** The group that makes level `k + 1` of detail from level `k`, for each level past the first. */
    mips: s.views.levels.slice(1).map((below, k) =>
      device.createBindGroup({
        layout: kernels.mips.layout,
        entries: [
          ...common,
          { binding: M.entries, resource: { buffer: s.entries } },
          { binding: M.above, resource: s.views.levels[k] },
          { binding: M.below, resource: below },
        ],
      }),
    ),
  }
}

/** The trace's group over a storage and what an image queued: made again only where one of them moved. */
export function cacheTraceBinder(device: GPUDevice, kernels: CacheKernels, wiring: CacheWiring) {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (s: CacheStorage, q: Queued) => {
    const { next } = identity
    next[0] = s
    next[1] = q.proxy.buffer
    next[2] = q.proxy.worlds
    next[3] = q.proxy.tree
    next[4] = q.lights
    next[5] = q.lists
    if (identity.moved()) {
      const B = CACHE_TRACE_BINDINGS
      group = device.createBindGroup({
        layout: kernels.trace.layout,
        entries: [
          { binding: B.grid, resource: { buffer: wiring.grid } },
          { binding: B.lights, resource: { buffer: q.lights } },
          { binding: B.queue, resource: { buffer: wiring.queue } },
          { binding: B.probes, resource: wiring.probes },
          { binding: B.lists, resource: { buffer: q.lists } },
          { binding: B.tiles, resource: { buffer: s.tiles } },
          { binding: B.raw, resource: s.views.raw },
          { binding: B.params, resource: { buffer: s.params } },
          ...sceneBindEntries(PROBE_PROXY, q.proxy),
        ],
      })
    }
    return group!
  }
}

/** The words of the cache's parameters (`RADIANCE_CACHE_PARAMS`) for an image of `settings`, the eye at `eye`, written with or
 *  without the importance functions. */
export function writeCacheParams(
  settings: ScreenProbeSettings,
  eye: ArrayLike<number>,
  importance: boolean,
  image: ArrayBuffer,
) {
  const P = RADIANCE_CACHE_PARAMS.at,
    { cache } = settings
  const words = new Uint32Array(image),
    floats = new Float32Array(image)
  words[P.size] = cache.resolution
  words[P.size + 1] =
    (importance ? RADIANCE_CACHE_FLAGS.importance : 0) |
    (cache.filter ? RADIANCE_CACHE_FLAGS.filter : 0) |
    (cache.skyVisibility ? RADIANCE_CACHE_FLAGS.sky : 0)
  words[P.size + 2] = RADIANCE_CACHE_TILE_MODES[cache.tiles]
  // The level a probe the pixels' lobes do not reach is traced at, in a frame the screen probes made none (`adaptive`): the whole side.
  words[P.size + 3] = 1
  floats[P.distances] = cache.downsampleSq
  floats[P.distances + 1] = cache.supersampleSq
  floats[P.distances + 2] = cache.supersampleThreshold
  floats[P.distances + 3] = cache.filterAngle
  floats.set([eye[0], eye[1], eye[2]], P.eye)
}
