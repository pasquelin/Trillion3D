import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { tableBytes, tableExtent } from '../atlas.ts'
import { ensureBounceFits } from '../limits.ts'
import { createBouncePool, type PoolStats } from '../pool/pool.ts'
import {
  POOL_MARK_WORDS,
  POOL_QUEUE,
  POOL_SLOT,
  POOL_TABLE_TEXELS,
  poolWorkWords,
} from '../pool/poolLayout.ts'
import { PROBE_QUEUE_WORDS } from './probeQueueWgsl.ts'
import { createCacheKernels } from '../cache/cacheKernels.ts'
import { createRadianceCache } from '../cache/radianceCache.ts'
import { createProbeStorage } from './probeStorage.ts'
import { createPlacementFollow } from './probeSync.ts'
import { createProbeEncoder, type ProbeParts, type ProbeScene } from './probeEncode.ts'

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** The screen probes' settings at their defaults: what the probes follow where no view names its own. */
const defaultScreenProbeSettings = (() => {
  let made: ScreenProbeSettings | undefined
  return () => (made ??= resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})))
})()

/**
 * What the probes are made of: the levels around the eye, the cell table and the levels' uniform, the pool and the radiance cache's
 * kernels — the storage released whole when one of them fails to build.
 */
async function createProbeRig(device: GPUDevice, bounds: readonly number[]) {
  const cascades = createBounceCascades(bounds)
  const extent = tableExtent(cascades.levels.length * cascades.cells)
  const queueBytes = POOL_QUEUE * PROBE_QUEUE_WORDS * 4
  ensureBounceFits(device, extent, queueBytes, [
    { name: 'pool slots', bytes: cascades.probes * POOL_SLOT.words * 4 },
    { name: 'pool table', bytes: POOL_TABLE_TEXELS * 16 },
    { name: 'pool work', bytes: poolWorkWords(cascades.probes) * 4 },
    { name: 'marks', bytes: POOL_MARK_WORDS * 4 },
  ])
  const storage = createProbeStorage(device, cascades, queueBytes, extent)
  const { uniform, queue, table, view } = storage
  const release = () => {
    uniform.dispose()
    for (const resource of [queue, table]) resource.destroy()
  }
  try {
    const cacheKernels = await createCacheKernels(device)
    const pool = await createBouncePool(device, cascades, {
      grid: uniform.buffer,
      published: view,
      queue,
    })
    return { cascades, uniform, queue, view, extent, pool, cacheKernels, release }
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
    // The maps are made or given back before the image looks for work: a closed series finds some when they are made.
    encode: (...args: Parameters<typeof encoder.encode>) => {
      cache.follow(settings())
      return encoder.encode(...args)
    },
    restart: encoder.restart,
    get working() {
      return encoder.working
    },
    /** The probes the last pass that came back queued (the statistics come back a few images late). */
    get lastProbes() {
      return pool.stats.queued
    },
    /** The placements moved or arrived: the reach re-placed, the series restarted, the cells the image reads marked again
     *  (`probeSync.ts`), whether any did; `placements`: how many held a box then. */
    sync: follow.sync,
    placements: () => follow.boxes.placements,
    /** The pool's last statistics that came back: probes alive, those holding nothing yet — zero once every cell the image reads
     *  holds a map —, those short of their traces, marks refused for want of a probe, probes queued, cells marked (`pool/pool.ts`). */
    stats,
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
  /** The probes an image traces, those never traced first, in the cost of a whole map each (`resolveProbesPerFrame`): a count, or
   *  what is read at each image. */
  probesPerFrame: number | (() => number),
  /** The screen probes' settings, which the radiance cache follows, read at each image. */
  settings: () => ScreenProbeSettings = defaultScreenProbeSettings,
) {
  const rig = await createProbeRig(device, bounds)
  const { cascades, uniform } = rig
  const restartCache = { remade: () => undefined as void }
  const cache = createRadianceCache(
    device,
    rig.cacheKernels,
    { grid: uniform.buffer, table: rig.view, queue: rig.queue, slots: cascades.probes },
    () => restartCache.remade(),
  )
  const parts: ProbeParts = { cascades, pool: rig.pool, uniform, cache }
  const encoder = createProbeEncoder(
    parts,
    lights,
    typeof probesPerFrame === 'number' ? () => probesPerFrame : probesPerFrame,
    settings,
  )
  restartCache.remade = encoder.retrace
  const follow = createPlacementFollow({
    boxes: () => scene.boxes(),
    cascades,
    restart: encoder.restart,
  })
  return probeApi(rig, cache, encoder, follow, settings)
}
