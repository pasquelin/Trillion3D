import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
import {
  SCREEN_PROBE_RULES,
  resolveScreenProbes,
  type ScreenProbeSettings,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { createBounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import { markWords } from '../../../../../sdk-core/src/bounce/probeMarks.ts'
import { createProbePool } from '../../../../../sdk-core/src/bounce/probePool.ts'
import { probeBinder, probeLayout } from './probeGroup.ts'
import { atlasBytes, probeAtlasExtent } from '../atlas.ts'
import { ensureBounceFits } from '../limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { createSnapshotFollow } from '../snapshotFollow.ts'
import { createBounceSchedule } from '../schedule.ts'
import { createBounceMarks } from '../marks.ts'
import { createBounceCensus } from '../census.ts'
import { createRadianceCache } from '../cache/radianceCache.ts'
import { createCacheKernels, type CacheKernels } from '../cache/cacheKernels.ts'
import { createProbeStorage } from './probeStorage.ts'
import { createTableWrite } from './tableWrite.ts'
import { createProxyFollow } from './probeSync.ts'
import { createProbeEncoder, type ProbeParts, type ProbeScene } from './probeEncode.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import type { GpuLightTiles } from '../../tiles/tiles.ts'
import { worldLightLists } from '../worldLightLists.ts'

/** What the probes are made of, beside what they encode (`createProbeEncoder`): the extent of the atlas,
 *  its snapshot's storage and the release of it all. */
type ProbeRig = Omit<ProbeParts, 'cache'> & {
  extent: [number, number, number]
  views: { probes: GPUTextureView; snapshot: GPUTextureView }
  /** The radiance cache's kernels, and the hook the cache calls when its maps are made again (set once the encoder exists). */
  cacheKernels: CacheKernels
  release(): void
}

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** The screen probes' settings at their defaults: what the probes follow where no view names its own. */
const defaultScreenProbeSettings = (() => {
  let made: ScreenProbeSettings | undefined
  return () => (made ??= resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, {})))
})()

/** The pass's pipelines, each compiled off the thread: the update, the snapshot's follow-up, the
 *  table's writes, the marks and the census of the field. */
async function buildPasses(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  parts: Pick<ProbeParts, 'cascades' | 'pool' | 'queue' | 'records' | 'uniform' | 'counts'>,
  views: ProbeRig['views'],
) {
  const { cascades, pool, queue, records, uniform, counts } = parts
  const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE')
  return {
    cacheKernels: await createCacheKernels(device),
    pipeline: await buildComputeStage(device, [layout], module, 'updateProbes'),
    follow: await createSnapshotFollow(device, uniform.buffer, queue, views.probes, views.snapshot),
    table: await createTableWrite(device, records, views.probes, views.snapshot),
    marks: await createBounceMarks(device, cascades, pool, uniform.buffer, views.probes),
    census: await createBounceCensus(device, cascades, uniform.buffer, views.probes, counts),
  }
}

/** The storage released whole: the levels' uniform, every buffer and both atlases. */
function releaseStorage(storage: ReturnType<typeof createProbeStorage>) {
  const { uniform, queue, records, census, probes, snapshot } = storage
  uniform.dispose()
  for (const resource of [queue, records, census, probes, snapshot]) resource.destroy()
}

/**
 * What the probes are made of: the levels around the eye, the pool and its schedule, the atlas, its
 * snapshot and the levels' uniform, the pass's bindings and its pipelines — the storage released whole when
 * one of them fails to build.
 */
async function createProbeRig(
  device: GPUDevice,
  bounds: readonly number[],
  lights: () => GPUBuffer,
  tiles: () => GpuLightTiles | undefined,
): Promise<ProbeRig> {
  const cascades = createBounceCascades(bounds)
  const pool = createProbePool(cascades)
  const schedule = createBounceSchedule(pool)
  const extent = probeAtlasExtent(pool.capacity, cascades.levels.length * cascades.cells)
  ensureBounceFits(device, extent, schedule.queue.byteLength, [
    { name: 'table records', bytes: schedule.records.byteLength },
    { name: 'marks', bytes: markWords(cascades) * 4 },
  ])
  const storage = createProbeStorage(
    device,
    cascades,
    schedule.queue.byteLength,
    schedule.records.byteLength,
    extent,
  )
  const { uniform, queue, records, census: counts, views } = storage
  const release = () => releaseStorage(storage)
  const layout = probeLayout(device)
  const bind = probeBinder(device, layout, {
    grid: uniform.buffer,
    queue,
    census: counts,
    ...views,
  })
  const parts = { cascades, pool, queue, records, uniform, counts }
  try {
    const passes = await buildPasses(device, layout, parts, views)
    const lists = worldLightLists(tiles, lights, uniform)
    return {
      ...parts,
      device,
      schedule,
      bind,
      lists,
      ...passes,
      extent,
      views,
      release,
    }
  } catch (error) {
    release()
    throw error
  }
}

/** The levels of probes around the eye, a pool of probes for the cells the image reads, bounded updates,
 *  tracing the scene's proxy wherever its placements stand. */
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
  /** The empty lists bound where no grid holds them (`DeferredPlaceholders.tiles`), and the light
   *  grid whose buffer holds the world grid's lists beside the view's. */
  noLists: GPUBuffer,
  tiles: () => GpuLightTiles | undefined = () => undefined,
  /** The screen probes' settings, which the radiance cache follows, read at each image. */
  settings: () => ScreenProbeSettings = defaultScreenProbeSettings,
) {
  const rig = await createProbeRig(device, bounds, lights, tiles)
  const { cascades, pool, uniform, marks, census, cacheKernels } = rig
  const readbacks = [marks, census]
  const restartCache = { remade: () => undefined as void }
  const cache = createRadianceCache(
    device,
    cacheKernels,
    { grid: uniform.buffer, probes: rig.views.probes, queue: rig.queue, slots: pool.capacity },
    () => restartCache.remade(),
  )
  const encoder = createProbeEncoder(
    { ...rig, cache },
    scene,
    lights,
    typeof probesPerFrame === 'number' ? () => probesPerFrame : probesPerFrame,
    noLists,
    settings,
  )
  restartCache.remade = encoder.retrace
  const restart = () => (encoder.restart(), marks.stale())
  const follow = createProxyFollow({ boxes: () => scene.boxes(), cascades, restart })
  return {
    cascades,
    pool,
    encode: encoder.encode,
    restart: encoder.restart,
    get working() {
      return encoder.working
    },
    get lastProbes() {
      return encoder.lastProbes
    },
    get lastRays() {
      return encoder.lastProbes * BOUNCE_SETTINGS.raysPerProbe
    },
    get lastTexels() {
      return encoder.lastTexels
    },
    /** The placements moved or arrived: the light grid and the reach re-placed, the series restarted, the
     *  cells the image reads marked again (`probeSync.ts`), whether any did; `worn`: what the proxy held then. */
    sync: follow.sync,
    worn: () => follow.boxes.worn,
    /** Probes alive holding nothing yet: zero once every cell the image reads holds light. */
    get unfilled() {
      return pool.unfilled
    },
    /** The marks that came back (how many, the cells of the last), and what the last census of the
     *  field that came back counted — none before the first (`census.ts`). */
    marked: marks.stats,
    counted: census.reading,
    uniform: uniform.buffer,
    /** The radiance cache: the maps of the light by direction in every probe, which the screen probes read. */
    cache,
    /** The probes' atlas, the pool's layer and the table's, which the lit passes read; what it weighs
     *  (the snapshot weighs as much). */
    probes: rig.views.probes,
    probeBytes: atlasBytes(rig.extent),
    setIrradianceView: uniform.setIrradianceView,
    /** After the image's submit: its marks and its census map. */
    submitted: () => readbacks.forEach((readback) => readback.submitted()),
    dispose: () => (
      readbacks.forEach((readback) => readback.dispose()),
      cache.dispose(),
      rig.release()
    ),
  }
}
