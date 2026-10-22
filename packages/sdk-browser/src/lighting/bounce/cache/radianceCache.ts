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
import { clearGroups } from './cacheTilesWgsl.ts'

/** The shape of the maps `settings` ask for. */
const shapeOf = ({ cache }: ScreenProbeSettings): CacheShape => ({
  resolution: cache.resolution,
  mipmaps: cache.mipmaps,
  skyVisibility: cache.skyVisibility,
})

/** The dispatches of the update: the clear of the importance functions and the screen probes' scatter into them, where they made
 *  any, the tiles of the probes queued, their trace, the filter, and the levels of detail past the first. */
function dispatchUpdate(
  pass: GPUComputePassEncoder,
  kernels: CacheKernels,
  groups: ReturnType<typeof cacheGroupsOf>,
  trace: GPUBindGroup,
  queued: number,
  tiles: GPUBuffer,
  scatter?: (pass: GPUComputePassEncoder) => void,
) {
  pass.setBindGroup(0, groups.tiles)
  if (scatter) {
    pass.setPipeline(kernels.tiles.clearPdf)
    pass.dispatchWorkgroups(clearGroups(queued))
    scatter(pass)
    pass.setBindGroup(0, groups.tiles)
  }
  pass.setPipeline(kernels.tiles.generateTiles)
  pass.dispatchWorkgroups(queued)
  pass.setPipeline(kernels.trace.traceTiles)
  pass.setBindGroup(0, trace)
  pass.dispatchWorkgroupsIndirect(tiles, 0)
  pass.setPipeline(kernels.filter.filterMaps)
  pass.setBindGroup(0, groups.filter)
  pass.dispatchWorkgroups(queued)
  groups.mips.forEach((group, level) => {
    pass.setPipeline(kernels.mips.levels[level])
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(queued)
  })
}

/**
 * THE RADIANCE CACHE of the world's probes: a map of the light by direction in every probe of the pool, made over the frames the
 * probes are traced in (`../probes/probeEncode.ts` queues them), and read by the screen probes (`../screen/cacheReadWgsl.ts`).
 * An image that queues probes (`queued`) leaves the update pending: the screen probes, where they cast, do it after their pixels'
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
  let storage: CacheStorage | undefined
  let groups: ReturnType<typeof cacheGroupsOf> | undefined
  let pending: Queued | undefined
  let settings: ScreenProbeSettings | undefined
  let unavailable: string | undefined
  /** The shape the budget refused to make maps of: not asked again until another is. */
  let refused: CacheShape | undefined
  const traceGroup = cacheTraceBinder(device, kernels, wiring)
  const image = new ArrayBuffer(RADIANCE_CACHE_PARAMS_BYTES)
  /** The storage for maps of the shape `shape`: the one held, else made — where the device's budget leaves room. */
  function ensure(shape: CacheShape) {
    if (storage && sameShape(storage.shape, shape)) return storage
    if (refused && sameShape(refused, shape)) return undefined
    const old = storage
    const { value, why } = ledgerAdmitted(device, {
      replaced: old ? cacheBytes(old.shape, wiring.slots) : 0,
      asked: cacheBytes(shape, wiring.slots),
      what: 'the radiance cache',
      make: () => createCacheStorage(device, shape, wiring.slots),
    })
    if (old) retire(device, { destroy: () => destroyCacheStorage(old) })
    storage = value
    groups = value && cacheGroupsOf(device, kernels, wiring, value)
    unavailable = why
    refused = value ? undefined : shape
    if (value) remade()
    return value
  }
  /** The maps given back: destroyed once the image that names them is submitted. */
  function release() {
    const old = storage
    if (old) retire(device, { destroy: () => destroyCacheStorage(old) })
    storage = groups = pending = unavailable = refused = undefined
  }
  const encode = (pass: GPUComputePassEncoder, scatter?: (pass: GPUComputePassEncoder) => void) => {
    const queued = pending
    pending = undefined
    if (!queued || !storage || !groups || !settings) return false
    writeCacheParams(settings, queued.eye, !!scatter, image)
    device.queue.writeBuffer(storage.params, 0, image)
    const trace = traceGroup(storage, queued)
    dispatchUpdate(pass, kernels, groups, trace, queued.groups, storage.tiles, scatter)
    return true
  }
  return {
    /** Why the cache could not be made, when it could not. */
    get reason() {
      return unavailable
    },
    /** The maps the screen probes read — the final atlas, the raw one's distances, the sky's share, the tags — and the importance
     *  functions they add to, none while there are none. */
    get views() {
      return (
        storage && {
          raw: storage.views.raw,
          final: storage.views.final,
          sky: storage.views.sky,
          tags: storage.tags,
          pdf: storage.pdf,
        }
      )
    },
    /** Bytes the maps hold. */
    get bytes() {
      return storage ? cacheBytes(storage.shape, wiring.slots) : 0
    },
    /** Whether an update is pending: probes were queued and the image has not made them yet. */
    get pending() {
      return pending !== undefined
    },
    /** Probes were queued for this image: the maps' atlases follow `now`, the tile list is emptied, the update is pending. */
    queued(now: ScreenProbeSettings, queued: Queued) {
      pending = undefined
      settings = now
      // No screen probe reads the maps — a level that casts none, or the switch off —: none are kept.
      if (!now.radianceCache) return release()
      const s = ensure(shapeOf(now))
      if (!s || !queued.groups) return
      resetList(device, s.tiles)
      pending = queued
    },
    /**
     * The update of the maps of the probes queued, in `pass`: with `scatter`, the screen probes' own dispatch that adds their
     * pixels' importance to the probes' functions (`scatterPdf`), after those were cleared; without it the maps are cut by the
     * mode alone. Returns whether an update was made.
     */
    encode,
    /** The update of the image, made now in a pass of its own, where the screen probes made none. */
    flush(encoder: GPUCommandEncoder) {
      if (!pending) return
      const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
      encode(pass)
      pass.end()
    },
    dispose: release,
  }
}

/** The radiance cache, made. */
export type RadianceCache = ReturnType<typeof createRadianceCache>
