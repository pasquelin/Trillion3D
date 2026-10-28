import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { BOUNCE_SETTINGS, type BounceShape } from '../../../../../sdk-core/src/bounce/contracts.ts'
import { tableBytes, tableExtent } from '../atlas.ts'
import { ensureBounceFits } from '../limits.ts'
import { createBouncePool, type PoolStats } from '../pool/pool.ts'
import { POOL_SLOT, poolShapeOf, poolWorkWords } from '../pool/poolLayout.ts'
import { PROBE_QUEUE_WORDS } from './probeQueueWgsl.ts'
import { lightAtlasFormat, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { createCacheKernels } from '../cache/cacheKernels.ts'
import { createRadianceCache, type AfterUpdate } from '../cache/radianceCache.ts'
import { createProbeStorage } from './probeStorage.ts'
import { createPlacementFollow } from './probeSync.ts'
import { createProbeEncoder, type ProbeParts, type ProbeScene } from './probeEncode.ts'

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** The screen probes' settings at their defaults: what the probes follow where no view names its own. */
const defaultScreenProbeSettings = (() => {
  let made: ScreenProbeSettings | undefined
  return () => (made ??= resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})))
})()

/** What a cache of probes is made to: the shape of its levels and pool, and whether the image's surfaces mark its cells (the world's probes) or
 *  only the engine's other passes do (a cache of its own, like the translucency volume's). */
export interface ProbeOptions {
  shape?: BounceShape
  surfaceMarks?: boolean
  /** A pass that follows each update of the radiance cache's maps (`AfterUpdate`): the irradiance field's maps. */
  afterUpdate?: AfterUpdate
  /** Whether the cells take adaptive probes where the pixels miss the interpolation (`irradianceFieldAdaptivePlacement`): the irradiance field's cache alone. */
  adaptive?: boolean
}

/**
 * What the probes are made of: the levels around the eye, the cell table and the levels' uniform, the pool and the radiance cache's
 * kernels — the storage released whole when one of them fails to build.
 */
async function createProbeRig(
  device: GPUDevice,
  bounds: readonly number[],
  light: LightAtlasFormat,
  { shape = BOUNCE_SETTINGS, surfaceMarks = true, adaptive = false }: ProbeOptions,
) {
  const cascades = createBounceCascades(bounds, shape)
  const extent = tableExtent(cascades.levels.length * cascades.cells)
  const queueBytes = cascades.probes * PROBE_QUEUE_WORDS * 4
  const pool = poolShapeOf(cascades)
  ensureBounceFits(device, extent, queueBytes, [
    { name: 'pool slots', bytes: cascades.probes * POOL_SLOT.words * 4 },
    { name: 'pool table', bytes: pool.tableTexels * 16 },
    { name: 'pool work', bytes: poolWorkWords(cascades.probes) * 4 },
    { name: 'marks', bytes: pool.markWords * 4 },
  ])
  const storage = createProbeStorage(device, cascades, queueBytes, extent)
  const { uniform, queue, table, view } = storage
  const release = () => {
    uniform.dispose()
    for (const resource of [queue, table]) resource.destroy()
  }
  try {
    const cacheKernels = await createCacheKernels(device, light)
    const bouncePool = await createBouncePool(device, cascades, {
      grid: uniform.buffer,
      published: view,
      queue,
      surfaceMarks,
      adaptive,
    })
    return { cascades, uniform, queue, view, extent, pool: bouncePool, cacheKernels, release }
  } catch (error) {
    release()
    throw error
  }
}

/** What the probes answer to the frame: their cascades, their encode, their statistics and their cell table. */
function probeApi(
  rig: Awaited<ReturnType<typeof createProbeRig>>,
  cache: ReturnType<typeof createRadianceCache>,
  encoder: ReturnType<typeof createProbeEncoder>,
  follow: ReturnType<typeof createPlacementFollow>,
  settings: () => ScreenProbeSettings,
) {
  const { cascades, pool, uniform } = rig
  const stats: PoolStats = pool.stats
  return {
    cascades,
    /** The image's viewpoint and the pre-exposure its light is cached under, taken before anything reads the levels or the cache this
     *  image: the maps made or given back — a closed series finds work when they are made — and the levels re-centred on it. */
    track(viewpoint: ArrayLike<number>, preExposure: number) {
      cache.follow(settings(), preExposure)
      encoder.follow(viewpoint)
    },
    /** The image's probe pass, once `track` has taken its viewpoint (`probeEncode.ts`). */
    encode: encoder.encode,
    restart: encoder.restart,
    discard: encoder.discard,
    get working() {
      return encoder.working
    },
    /** The probes the last pass that came back queued (the statistics come back a few images late). */
    get lastProbes() {
      return pool.stats.queued
    },
    /** The placements moved or arrived: the series restarted (`probeSync.ts`), whether any did; `placements`: how many held a box then. */
    sync: follow.sync,
    placements: () => follow.boxes.placements,
    /** The pool's last statistics that came back: probes alive, those holding nothing yet — zero once every cell the image reads
     *  holds a map —, those not traced since the lights last changed, marks refused for want of a probe, probes queued, cells marked (`pool/pool.ts`). */
    stats,
    /** The buffers an adaptive pool's pixels read and write (`BouncePool.adaptive`): the slots, the adaptive probes of each entry and the interpolation misses. */
    adaptive: pool.adaptive,
    uniform: uniform.buffer,
    /** The radiance cache: the maps of the light by direction in every probe, which the screen probes read. */
    cache,
    /** The cell table, which the passes that look for the probe of a cell read (`../atlas.ts`); what it weighs. */
    table: rig.view,
    tableBytes: tableBytes(rig.extent),
    /** After the image's submit: its pool statistics. */
    submitted: () => pool.submitted(),
    dispose: () => (pool.dispose(), cache.dispose(), rig.release()),
  }
}

/** The levels of probes around the eye, a pool of probes for the cells the image reads, a bounded count traced each image: the
 *  radiance cache's maps, traced through the scene's global distance field, the light of their hits the surface cache's. */
export async function createGpuBounceProbes(
  device: GPUDevice,
  /** The extent of the scene's placements: three lower bounds then three upper. */
  bounds: readonly number[],
  scene: ProbeScene,
  /** The declared-light buffer, read at each encode: it is replaced when the scene outgrows it. */
  lights: () => GPUBuffer,
  /** The settings the radiance cache follows (the screen probes', or a cache of its own), read at each image. */
  settings: () => ScreenProbeSettings = defaultScreenProbeSettings,
  options: ProbeOptions = {},
) {
  const light = lightAtlasFormat(settings().cache.light, device.features)
  const rig = await createProbeRig(device, bounds, light, options)
  const { cascades, uniform } = rig
  const restartCache = { remade: () => undefined as void }
  const cache = createRadianceCache(
    device,
    { light, kernels: rig.cacheKernels },
    { grid: uniform.buffer, table: rig.view, queue: rig.queue, slots: cascades.probes },
    () => restartCache.remade(),
    options.afterUpdate,
  )
  const parts: ProbeParts = { cascades, pool: rig.pool, uniform, cache }
  const encoder = createProbeEncoder(parts, lights, settings)
  restartCache.remade = encoder.discard
  const follow = createPlacementFollow({
    boxes: () => scene.boxes(),
    restart: encoder.restart,
  })
  return probeApi(rig, cache, encoder, follow, settings)
}
