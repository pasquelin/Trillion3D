import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { ledgerAdmitted } from '../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import { resetList } from '../../../gpu/dispatch/list.ts'
import { BOUNCE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import {
  cacheGroupsOf,
  cacheTraceBinder,
  writeCacheParams,
  type CacheWiring,
  type Queued,
} from './cacheGroups.ts'
import type { CacheKernels } from './cacheKernels.ts'
import {
  RADIANCE_CACHE_PARAMS_BYTES,
  cacheBytes,
  sameShape,
  type CacheShape,
} from './cacheLayout.ts'
import { createCacheStorage, destroyCacheStorage, type CacheStorage } from './cacheStorage.ts'
import { POOL_ARGS } from '../pool/poolLayout.ts'

/** The shape of the maps `settings` ask for. */
const shapeOf = ({ cache }: ScreenProbeSettings): CacheShape => ({
  resolution: cache.resolution,
  mipmaps: cache.mipmaps,
  skyVisibility: cache.skyVisibility,
})

/** The dispatches of the update: the clear of the importance functions and the screen probes' scatter into them, where they made
 *  any, the tiles of the probes queued, their trace, the filter, and the levels of detail past the first. The probes the image queued are
 *  the GPU's to count: each dispatch over them takes the arguments the pool wrote (`args`, `POOL_ARGS`). */
function dispatchUpdate(
  pass: GPUComputePassEncoder,
  kernels: CacheKernels,
  groups: ReturnType<typeof cacheGroupsOf>,
  trace: GPUBindGroup,
  args: GPUBuffer,
  tiles: GPUBuffer,
  scatter?: (pass: GPUComputePassEncoder) => void,
) {
  const probes = POOL_ARGS.probes * 4
  pass.setBindGroup(0, groups.tiles)
  if (scatter) {
    pass.setPipeline(kernels.tiles.clearPdf)
    pass.dispatchWorkgroupsIndirect(args, POOL_ARGS.clear * 4)
    scatter(pass)
    pass.setBindGroup(0, groups.tiles)
  }
  pass.setPipeline(kernels.tiles.generateTiles)
  pass.dispatchWorkgroupsIndirect(args, probes)
  pass.setPipeline(kernels.trace.traceTiles)
  pass.setBindGroup(0, trace)
  pass.dispatchWorkgroupsIndirect(tiles, 0)
  pass.setPipeline(kernels.filter.filterMaps)
  pass.setBindGroup(0, groups.filter)
  pass.dispatchWorkgroupsIndirect(args, probes)
  groups.mips.forEach((group, level) => {
    pass.setPipeline(kernels.mips.levels[level])
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroupsIndirect(args, probes)
  })
}

/** What the radiance cache keeps between two images. */
interface CacheState {
  readonly device: GPUDevice
  readonly kernels: CacheKernels
  readonly wiring: CacheWiring
  readonly remade: () => void
  readonly traceGroup: ReturnType<typeof cacheTraceBinder>
  readonly image: ArrayBuffer
  storage: CacheStorage | undefined
  groups: ReturnType<typeof cacheGroupsOf> | undefined
  pending: Queued | undefined
  settings: ScreenProbeSettings | undefined
  unavailable: string | undefined
  /** The shape the budget refused to make maps of: not asked again until another is. */
  refused: CacheShape | undefined
}

/** The maps of `old` destroyed once the image that names them is submitted. */
const giveBack = (device: GPUDevice, old: CacheStorage) =>
  retire(device, { destroy: () => destroyCacheStorage(old) })

/** The storage for maps of the shape `shape`: the one held, else made — where the device's budget leaves room. */
function ensure(state: CacheState, shape: CacheShape) {
  const { device, kernels, wiring } = state
  if (state.storage && sameShape(state.storage.shape, shape)) return state.storage
  if (state.refused && sameShape(state.refused, shape)) return undefined
  const old = state.storage
  const { value, why } = ledgerAdmitted(device, {
    held: old && {
      bytes: cacheBytes(old.shape, wiring.slots),
      dispose: () => giveBack(device, old),
    },
    asked: cacheBytes(shape, wiring.slots),
    what: 'the radiance cache',
    make: () => createCacheStorage(device, shape, wiring.slots),
  })
  state.storage = value
  state.groups = value && cacheGroupsOf(device, kernels, wiring, value)
  state.unavailable = why
  state.refused = value ? undefined : shape
  if (value) state.remade()
  return value
}

/** The maps given back: destroyed once the image that names them is submitted. */
function release(state: CacheState) {
  if (state.storage) giveBack(state.device, state.storage)
  state.storage = state.groups = state.pending = state.unavailable = state.refused = undefined
}

function follow(state: CacheState, now: ScreenProbeSettings) {
  state.settings = now
  if (!now.radianceCache) return release(state)
  ensure(state, shapeOf(now))
}

function encode(
  state: CacheState,
  pass: GPUComputePassEncoder,
  scatter?: (pass: GPUComputePassEncoder) => void,
) {
  const queued = state.pending
  state.pending = undefined
  const { storage, groups, settings } = state
  if (!queued || !storage || !groups || !settings) return false
  writeCacheParams(settings, queued.eye, !!scatter, state.image)
  state.device.queue.writeBuffer(storage.params, 0, state.image)
  const trace = state.traceGroup(storage, queued)
  dispatchUpdate(pass, state.kernels, groups, trace, queued.args, storage.tiles, scatter)
  return true
}

/** The maps the screen probes read, none while there are none. */
const viewsOf = (storage: CacheStorage | undefined) =>
  storage && {
    raw: storage.views.raw,
    final: storage.views.final,
    sky: storage.views.sky,
    tags: storage.tags,
    pdf: storage.pdf,
  }

/** Probes may have been queued for this image: the maps follow `now`, the tile list is emptied, the update is pending. */
function queue(state: CacheState, now: ScreenProbeSettings, queued: Queued) {
  state.pending = undefined
  follow(state, now)
  const s = state.storage
  if (!s) return
  resetList(state.device, s.tiles)
  state.pending = queued
}

/** The update of the image, made now in a pass of its own, where the screen probes made none. */
function flush(state: CacheState, encoder: GPUCommandEncoder) {
  if (!state.pending) return
  const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
  encode(state, pass)
  pass.end()
}

/**
 * THE RADIANCE CACHE of the world's probes: a map of the light by direction in every probe of the pool, made over the frames the
 * probes are traced in (`../pool/pool.ts` queues them), and read by the screen probes (`../screen/cacheReadWgsl.ts`).
 * An image that works the pool (`queued`) leaves the update pending: the screen probes, where they cast, do it after their pixels'
 * importance functions are made and give them in (`encode`), else the frame's end does without them (`flush`). The update
 * is the clear of the importance functions, the screen probes' scatter into them, the tiles of every probe awake, their trace,
 * the filter and the levels of detail (`cacheTilesWgsl.ts`, `cacheTraceWgsl.ts`, `cacheFilterWgsl.ts`, `cacheMipsWgsl.ts`). The
 * maps' shape — their side, a level's row, their levels of detail, the sky apart — is the settings': a change of it makes the
 * atlases again, every probe is traced anew (`remade`), and none is read meanwhile.
 */
export function createRadianceCache(
  device: GPUDevice,
  kernels: CacheKernels,
  wiring: CacheWiring,
  remade: () => void,
) {
  const state: CacheState = {
    device,
    kernels,
    wiring,
    remade,
    traceGroup: cacheTraceBinder(device, kernels, wiring),
    image: new ArrayBuffer(RADIANCE_CACHE_PARAMS_BYTES),
    storage: undefined,
    groups: undefined,
    pending: undefined,
    settings: undefined,
    unavailable: undefined,
    refused: undefined,
  }
  return {
    /** Why the cache could not be made, when it could not. */
    get reason() {
      return state.unavailable
    },
    /** The maps the screen probes read — the final atlas, the raw one's distances, the sky's share, the tags — and the importance
     *  functions they add to, none while there are none. */
    get views() {
      return viewsOf(state.storage)
    },
    /** Bytes the maps hold. */
    get bytes() {
      return state.storage ? cacheBytes(state.storage.shape, wiring.slots) : 0
    },
    /** Whether an update is pending: probes were queued and the image has not made them yet. */
    get pending() {
      return state.pending !== undefined
    },
    /** The maps follow the settings `now`: made where they are read and none are held — a series that is closed finds work again —,
     *  made again where their shape changed, given back where no screen probe reads them (a level that casts none, or the switch off). */
    follow: (now: ScreenProbeSettings) => follow(state, now),
    /** Probes may have been queued for this image: the maps follow `now`, the tile list is emptied, the update is pending. */
    queued: (now: ScreenProbeSettings, queued: Queued) => queue(state, now, queued),
    /**
     * The update of the maps of the probes queued, in `pass`: with `scatter`, the screen probes' own dispatch that adds their
     * pixels' importance to the probes' functions (`scatterPdf`), after those were cleared; without it the maps are cut by the
     * mode alone. Returns whether an update was made.
     */
    encode: (pass: GPUComputePassEncoder, scatter?: (pass: GPUComputePassEncoder) => void) =>
      encode(state, pass, scatter),
    /** The update of the image, made now in a pass of its own, where the screen probes made none. */
    flush: (encoder: GPUCommandEncoder) => flush(state, encoder),
    dispose: () => release(state),
  }
}

/** The radiance cache, made. */
export type RadianceCache = ReturnType<typeof createRadianceCache>
