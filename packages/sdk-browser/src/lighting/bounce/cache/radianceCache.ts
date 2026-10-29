import type { SurfaceHitReads } from '../../surfaceCache/hitWgsl.ts'
import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { ledgerAdmitted } from '../../../gpu/core/deviceLedger.ts'
import { retire } from '../../../gpu/core/frameRetire.ts'
import {
  dropTemp,
  dropTraceAtlas,
  tempFor,
  traceAtlasFor,
  type FrameAtlases,
} from './frameAtlases.ts'
import { resetList } from '../../../gpu/dispatch/list.ts'
import { BOUNCE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { atlasLimitFailure } from '../limits.ts'
import {
  cacheFilterBinder,
  cacheFixupBinder,
  cacheGroupsOf,
  cacheSplatBinder,
  cacheTracedBinder,
  cacheTraceBinder,
  writeCacheParams,
  type CacheWiring,
  type Queued,
} from './cacheGroups.ts'
import { lightAtlasFormat, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { createCacheKernels, tracedCacheKernels, type CacheKernels } from './cacheKernels.ts'
import {
  RADIANCE_CACHE_PARAMS,
  RADIANCE_CACHE_PARAMS_BYTES,
  cacheBytes,
  cacheExtent,
  cacheFinalSide,
  cacheTraceSlices,
  cacheTraceTiles,
  sameShape,
  type CacheShape,
} from './cacheLayout.ts'
import { clearCacheMaps } from './cacheClear.ts'
import { createCacheStorage, destroyCacheStorage, type CacheStorage } from './cacheStorage.ts'
import { wordViews } from '../../../gpu/core/wordViews.ts'
import { writeChanged } from '../../../gpu/core/writeChanged.ts'
import { noiseViewOn } from '../../../gpu/noise/blueNoiseTextures.ts'
import { POOL_ARGS } from '../pool/poolLayout.ts'

/** The cell of the tile list that names the first tile of the slice being traced, as an update begins. */
const FIRST_SLICE = new Uint32Array(1)

/** The shape of the maps `settings` ask for. */
const shapeOf = ({ cache }: ScreenProbeSettings, device: GPUDevice): CacheShape => ({
  resolution: cache.resolution,
  mipmaps: cache.mipmaps,
  skyVisibility: cache.skyVisibility,
  light: lightAtlasFormat(cache.light, device.features),
})

/** The trace of the tiles of an update: its pipeline and the bind groups it takes, from group 0; where the rays are cast through the scene's
 *  triangles, the group of the spread of the trace atlas into the raw atlas that follows it. */
interface TraceDispatch {
  readonly pipeline: GPUComputePipeline
  readonly groups: readonly GPUBindGroup[]
  readonly splat?: GPUBindGroup
}

/** The groups of the dispatches an update makes over the frame's atlases: the filter's and the fixup's. */
interface UpdateGroups {
  readonly filter: GPUBindGroup
  readonly fixup: GPUBindGroup
}

/** The dispatches of the update: the tiles of the probes queued, their trace (and, through the scene's triangles, the spread of the trace
 *  atlas, in `slices` of the list's tiles one after the other where the atlas holds fewer than the list), the filter where the setting asks for it, and the final maps with their border and levels of detail. The probes the image queued
 *  are the GPU's to count: each dispatch over them takes the arguments the pool wrote (`args`, `POOL_ARGS`). */
function dispatchUpdate(
  pass: GPUComputePassEncoder,
  kernels: CacheKernels,
  groups: ReturnType<typeof cacheGroupsOf>,
  after: UpdateGroups,
  filtered: boolean,
  trace: TraceDispatch,
  slices: number,
  sorted: boolean,
  args: GPUBuffer,
  tiles: GPUBuffer,
) {
  const probes = POOL_ARGS.probes * 4
  pass.setBindGroup(0, groups.tiles)
  pass.setPipeline(kernels.tiles.generateTiles)
  pass.dispatchWorkgroupsIndirect(args, probes)
  if (sorted) {
    pass.setPipeline(kernels.tiles.sortTiles)
    pass.dispatchWorkgroupsIndirect(tiles, 0)
  }
  for (let slice = 0; slice < slices; slice++) {
    if (slice > 0) {
      pass.setBindGroup(0, groups.tiles)
      pass.setPipeline(kernels.tiles.advanceSlice)
      pass.dispatchWorkgroups(1)
    }
    pass.setPipeline(trace.pipeline)
    trace.groups.forEach((group, at) => pass.setBindGroup(at, group))
    pass.dispatchWorkgroupsIndirect(tiles, 0)
    if (trace.splat) {
      pass.setPipeline(kernels.splat.spreadTiles)
      pass.setBindGroup(0, trace.splat)
      pass.dispatchWorkgroupsIndirect(tiles, 0)
    }
  }
  if (filtered) {
    pass.setPipeline(kernels.filter.filterMaps)
    pass.setBindGroup(0, after.filter)
    pass.dispatchWorkgroupsIndirect(args, probes)
  }
  pass.setPipeline(kernels.fixup.fixupMaps)
  pass.setBindGroup(0, after.fixup)
  pass.dispatchWorkgroupsIndirect(args, probes)
}

/** What the radiance cache keeps between two images. */
interface CacheState extends FrameAtlases {
  /** The kernels made, by the format the maps' light is stored in: a format asked is compiled off the frame (`kernelsFor`). */
  readonly kernels: Map<LightAtlasFormat, CacheKernels>
  /** The formats whose kernels were asked of the device and are still compiling. */
  readonly compiling: Set<LightAtlasFormat>
  readonly wiring: CacheWiring
  readonly remade: () => void
  readonly traceGroup: ReturnType<typeof cacheTraceBinder>
  readonly tracedGroups: ReturnType<typeof cacheTracedBinder>
  readonly splatGroup: ReturnType<typeof cacheSplatBinder>
  readonly filterGroup: ReturnType<typeof cacheFilterBinder>
  readonly fixupGroup: ReturnType<typeof cacheFixupBinder>
  readonly image: ArrayBuffer
  storage: CacheStorage | undefined
  groups: ReturnType<typeof cacheGroupsOf> | undefined
  pending: Queued | undefined
  settings: ScreenProbeSettings | undefined
  /** The pre-exposure the maps' light was traced under: the maps held are made again when it changes. */
  preExposure: number | undefined
  unavailable: string | undefined
  /** The shape the budget refused to make maps of: not asked again until another is. */
  refused: CacheShape | undefined
  /** The pass that follows each update, if any. */
  readonly after: AfterUpdate | undefined
  /** An update the budget left no room for the atlases of its frame: the probes it held were counted as traced, so every probe is
   *  traced anew once the atlases are made again. */
  missed: boolean
}

/** The kernels for maps stored in the format `light`: those made, else asked of the device off the frame and none until they land (the maps held go
 *  on meanwhile); a device that refuses them leaves the reason (`unavailable`). */
function kernelsFor(state: CacheState, light: LightAtlasFormat) {
  const made = state.kernels.get(light)
  if (made || state.compiling.has(light)) return made
  state.compiling.add(light)
  createCacheKernels(state.device, light).then(
    (kernels) => (state.compiling.delete(light), state.kernels.set(light, kernels)),
    (error: unknown) => (state.compiling.delete(light), (state.unavailable = String(error))),
  )
  return undefined
}

/** The maps of `old` destroyed once the image that names them is submitted. */
const giveBack = (device: GPUDevice, old: CacheStorage) =>
  retire(device, { destroy: () => destroyCacheStorage(old) })

/** The storage for maps of the shape `shape`: the one held unless `remake` asks for new maps, else made — where the device's budget
 *  leaves room, the maps held and the atlases of their frames counted as given back. */
function ensure(state: CacheState, shape: CacheShape, remake = false) {
  const { device, wiring } = state
  if (!remake && state.storage && sameShape(state.storage.shape, shape)) return state.storage
  if (state.refused && sameShape(state.refused, shape)) return undefined
  const kernels = kernelsFor(state, shape.light)
  if (!kernels) return state.storage
  const old = state.storage
  // The final atlas is the widest the cache makes: a device whose textures are narrower holds no map of this shape.
  const tooWide = atlasLimitFailure(device, [
    {
      name: 'radiance cache',
      extent: cacheExtent(cacheFinalSide(shape.resolution, shape.mipmaps), wiring.slots),
    },
  ])
  if (tooWide && old) giveBack(device, old)
  const { value, why } = tooWide
    ? { value: undefined, why: tooWide }
    : ledgerAdmitted(device, {
        held: old && {
          bytes:
            cacheBytes(old.shape, wiring.slots) +
            (state.temp?.bytes ?? 0) +
            (state.traceAtlas?.bytes ?? 0),
          dispose: () => {
            giveBack(device, old)
            dropTemp(state)
          },
        },
        asked: cacheBytes(shape, wiring.slots),
        what: 'the radiance cache',
        make: () => createCacheStorage(device, shape, wiring.slots),
      })
  dropTemp(state)
  state.storage = value
  state.groups = value && cacheGroupsOf(device, kernels, wiring, value)
  state.unavailable = why
  state.refused = value ? undefined : shape
  if (value) {
    // The maps are new and traced anew whole: an update missed on the old ones is not made up a second time.
    state.missed = false
    state.remade()
  }
  return value
}

/** The maps given back: destroyed once the image that names them is submitted. */
function release(state: CacheState) {
  dropTemp(state)
  if (state.storage) giveBack(state.device, state.storage)
  state.storage = state.groups = state.pending = state.unavailable = state.refused = undefined
  state.missed = false
}

/** The maps follow `now`, and the pre-exposure their light is kept under: where it changed they are made again, the update queued
 *  under the old one dropped and a shape the budget refused asked again. */
function follow(state: CacheState, now: ScreenProbeSettings, preExposure: number) {
  const exposed = state.preExposure !== undefined && state.preExposure !== preExposure
  state.preExposure = preExposure
  state.settings = now
  if (!now.radianceCache) return release(state)
  if (exposed) state.pending = state.refused = undefined
  // The trace atlas is the rays cast through the scene's triangles': held only while the setting asks for them.
  if (!now.values.screenProbeRadianceCacheHardwareRayTracing) dropTraceAtlas(state)
  ensure(state, shapeOf(now, state.device), exposed)
}

/**
 * The trace of an update: through the scene's triangles where the settings ask for it (`screenProbeRadianceCacheHardwareRayTracing`)
 * and the image has the scene trace (`queued.rays`) and the program is compiled (not waited for: until it is, the rays are marched
 * through the global distance field, as they are where the scene has no acceleration structures). The rays cast through the triangles are
 * written to the trace atlas, which the spread then writes to the raw atlas by slot.
 */
function traceOf(
  state: CacheState,
  kernels: CacheKernels,
  storage: CacheStorage,
  queued: Queued,
  settings: ScreenProbeSettings,
  traceTiles: number,
): TraceDispatch {
  const { rays } = queued
  if (rays && settings.values.screenProbeRadianceCacheHardwareRayTracing) {
    const traced = tracedCacheKernels(state.device, storage.shape.light)
    if (traced.ready) {
      const atlas = traceAtlasFor(state, traceTiles, storage.shape.light)
      if (atlas)
        return {
          pipeline: traced.pipeline(),
          groups: state.tracedGroups(traced, storage, queued, rays, atlas),
          splat: state.splatGroup(kernels, storage, atlas),
        }
    }
  }
  return {
    pipeline: kernels.trace.traceTiles,
    groups: [state.traceGroup(kernels, storage, queued)],
  }
}

function encode(state: CacheState, pass: GPUComputePassEncoder) {
  const queued = state.pending
  state.pending = undefined
  const { storage, groups, settings } = state
  const kernels = storage && state.kernels.get(storage.shape.light)
  if (!queued || !storage || !kernels || !groups || !settings) return false
  const temp = tempFor(state, storage, queued.queue)
  if (!temp) {
    state.missed = true
    return false
  }
  if (state.missed) {
    state.missed = false
    state.remade()
  }
  const traceTiles = cacheTraceTiles(
    storage.shape.resolution,
    queued.queue,
    settings.cache.tiles,
    queued.queue.full,
  )
  const trace = traceOf(state, kernels, storage, queued, settings, traceTiles)
  writeCacheParams(
    settings,
    queued.eye,
    state.image,
    { queue: queued.queue, traceTiles, traced: trace.splat !== undefined },
    queued.rays,
  )
  writeChanged(
    state.device,
    storage.params,
    wordViews(state.image).u,
    0,
    RADIANCE_CACHE_PARAMS.words,
  )
  const after = {
    filter: state.filterGroup(kernels, storage, temp, noiseViewOn(state.device)),
    fixup: state.fixupGroup(kernels, storage, temp),
  }
  dispatchUpdate(
    pass,
    kernels,
    groups,
    after,
    settings.cache.filter,
    trace,
    trace.splat
      ? cacheTraceSlices(storage.shape.resolution, queued.queue, traceTiles, queued.queue.full)
      : 1,
    settings.cache.sortTiles,
    queued.args,
    storage.tiles,
  )
  state.after?.(pass, { wiring: state.wiring, storage, args: queued.args, reads: queued.reads })
  return true
}

/** What a cache hands the pass that follows its update (`AfterUpdate`): the wiring of the pool the maps are laid out by, the storage of the maps and the arguments of the dispatches over the probes queued. */
interface UpdateParts {
  readonly wiring: CacheWiring
  readonly storage: CacheStorage
  readonly args: GPUBuffer
  /** What the image's rays read: the global field among it, which the field's probe validity reads. */
  readonly reads: SurfaceHitReads
}

/** A pass that follows the update of the maps in the same compute pass, over the probes queued (the irradiance field's maps). */
export type AfterUpdate = (pass: GPUComputePassEncoder, parts: UpdateParts) => void

/** Probes may have been queued for this image: the maps follow `now`, the tile list is emptied, the update is pending. */
function queue(state: CacheState, now: ScreenProbeSettings, queued: Queued) {
  state.pending = undefined
  follow(state, now, queued.preExposure)
  const s = state.storage
  if (!s) return
  resetList(state.device, s.tiles)
  // The first tile of the slice the trace begins with: the list's last cell (`advanceSlice`).
  state.device.queue.writeBuffer(s.tiles, s.tiles.size - 8, FIRST_SLICE)
  state.pending = queued
}

/** The update of the image, made now in a pass of its own, where the screen probes have not made it. */
function flush(state: CacheState, encoder: GPUCommandEncoder) {
  if (!state.pending) return
  const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
  encode(state, pass)
  pass.end()
}

/** A cache's state with nothing made: the kernels of the format the maps are first stored in, the groups' binders and the parameters' image. */
function newCacheState(
  device: GPUDevice,
  first: { light: LightAtlasFormat; kernels: CacheKernels },
  wiring: CacheWiring,
  remade: () => void,
  after: AfterUpdate | undefined,
): CacheState {
  return {
    device,
    kernels: new Map([[first.light, first.kernels]]),
    compiling: new Set(),
    wiring,
    remade,
    after,
    traceGroup: cacheTraceBinder(device, wiring),
    tracedGroups: cacheTracedBinder(device, wiring),
    splatGroup: cacheSplatBinder(device, wiring),
    filterGroup: cacheFilterBinder(device, wiring),
    fixupGroup: cacheFixupBinder(device, wiring),
    image: new ArrayBuffer(RADIANCE_CACHE_PARAMS_BYTES),
    storage: undefined,
    temp: undefined,
    traceAtlas: undefined,
    smallTemp: 0,
    smallTrace: 0,
    groups: undefined,
    pending: undefined,
    settings: undefined,
    preExposure: undefined,
    unavailable: undefined,
    refused: undefined,
    missed: false,
  }
}

/**
 * THE RADIANCE CACHE of the world's probes: a map of the light by direction in every probe of the pool, made over the frames the
 * probes are traced in (`../pool/pool.ts` queues them), and read by the screen probes (`../screen/cacheReadWgsl.ts`).
 * An image that works the pool (`queued`) leaves the update pending: the screen probes, where they cast, do it in their own pass
 * (`encode`), else the frame's end does (`flush`). The update is the tiles of every probe awake, their trace (through the scene's triangles,
 * into the trace atlas and then the raw atlas), the filter and the final maps with their border and levels of detail (`cacheTilesWgsl.ts`,
 * `cacheTraceWgsl.ts`, `cacheFilterWgsl.ts`, `cacheFixupWgsl.ts`). The
 * maps' shape — their side, a level's row, their levels of detail, the sky apart — is the settings': a change of it makes the
 * atlases again, every probe is traced anew (`remade`), and none is read meanwhile.
 */
export function createRadianceCache(
  device: GPUDevice,
  /** The kernels of the format the maps are first stored in, made by the caller (`createCacheKernels`); the others are compiled when a setting asks them. */
  first: { light: LightAtlasFormat; kernels: CacheKernels },
  wiring: CacheWiring,
  remade: () => void,
  after?: AfterUpdate,
) {
  const state = newCacheState(device, first, wiring, remade, after)
  return {
    /** Why the cache could not be made, when it could not. */
    get reason() {
      return state.unavailable
    },
    /** The maps the screen probes read — the final atlas, the raw one's distances, the sky's share —, none while there are none. */
    get views() {
      return state.storage?.read
    },
    /** Bytes the maps hold, and the atlases of the frame that are held. */
    get bytes() {
      return state.storage
        ? cacheBytes(state.storage.shape, wiring.slots) +
            (state.temp?.bytes ?? 0) +
            (state.traceAtlas?.bytes ?? 0)
        : 0
    },
    /** Whether an update is pending: probes were queued and the image has not made them yet. */
    get pending() {
      return state.pending !== undefined
    },
    /** The maps follow the settings `now` and the pre-exposure their light is kept under: made where they are read and none are held — a
     *  series that is closed finds work again —, made again where their shape or that pre-exposure changed (none read meanwhile, as the series
     *  starts over), given back where no screen probe reads them (a level that casts none, or the switch off). It is called before the pool's
     *  pass of the image, so that the pass the series restarts in is the image's own and the table never names a map the update of the
     *  image does not make. */
    follow: (now: ScreenProbeSettings, preExposure: number) => follow(state, now, preExposure),
    /** Probes may have been queued for this image: the maps follow `now`, the tile list is emptied, the update is pending. */
    queued: (now: ScreenProbeSettings, queued: Queued) => queue(state, now, queued),
    /** The final maps and the sky's share set to black in `encoder`, before an update that traces every probe anew (`screenProbeRadianceCacheForceFullUpdate`). */
    clear(encoder: GPUCommandEncoder) {
      if (state.storage) clearCacheMaps(device, encoder, state.storage)
    },
    /** The update of the maps of the probes queued, in `pass`. Returns whether an update was made. */
    encode: (pass: GPUComputePassEncoder) => encode(state, pass),
    /** The update of the image, made now in a pass of its own, where the screen probes made none. */
    flush: (encoder: GPUCommandEncoder) => flush(state, encoder),
    dispose: () => release(state),
  }
}

/** The radiance cache, made. */
export type RadianceCache = ReturnType<typeof createRadianceCache>
