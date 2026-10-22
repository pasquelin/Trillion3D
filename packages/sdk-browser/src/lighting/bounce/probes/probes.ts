import { BOUNCE_SETTINGS } from '../../../../../sdk-core/src/bounce/contracts.ts'
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
import { createHitMarks } from '../hitMarks.ts'
import { createBounceCensus } from '../census.ts'
import { createProbeStorage } from './probeStorage.ts'
import { createTableWrite } from './tableWrite.ts'
import { syncBounceProbes } from './probeSync.ts'
import { createProbeEncoder, type ProbeParts, type ProbeScene } from './probeEncode.ts'
import { createCheckedShaderModule } from '../../../gpu/core/shaderModule.ts'
import { buildComputeStage } from '../../../gpu/core/computeStages.ts'
import type { GpuLightTiles } from '../../tiles/tiles.ts'
import { worldLightLists } from '../worldLightLists.ts'

/** What the probes are made of, beside what they encode (`createProbeEncoder`): the extent of the atlas,
 *  its snapshot's storage and the release of it all. */
type ProbeRig = ProbeParts & {
  extent: [number, number, number]
  views: { probes: GPUTextureView; snapshot: GPUTextureView }
  release(): void
}

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** The pass's pipelines, each compiled off the thread: the update, the snapshot's follow-up, the
 *  table's writes, the marks, the readback of the cells the rays hit (`hitBits`: their bitmap) and the
 *  census of the field. */
async function buildPasses(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  parts: Pick<ProbeParts, 'cascades' | 'pool' | 'queue' | 'records' | 'uniform' | 'counts'>,
  views: ProbeRig['views'],
  hitBits: GPUBuffer,
) {
  const { cascades, pool, queue, records, uniform, counts } = parts
  const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE')
  return {
    pipeline: await buildComputeStage(device, [layout], module, 'updateProbes'),
    follow: await createSnapshotFollow(device, uniform.buffer, queue, views.probes, views.snapshot),
    table: await createTableWrite(device, records, views.probes, views.snapshot),
    marks: await createBounceMarks(device, cascades, pool, uniform.buffer, views.probes),
    hits: createHitMarks(device, cascades, pool, hitBits),
    census: await createBounceCensus(device, cascades, uniform.buffer, views.probes, counts),
  }
}

/** The storage released whole: the levels' uniform, every buffer and both atlases. */
function releaseStorage(storage: ReturnType<typeof createProbeStorage>) {
  const { uniform, queue, records, census, hits, probes, snapshot } = storage
  uniform.dispose()
  for (const resource of [queue, records, census, hits, probes, snapshot]) resource.destroy()
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
  const { uniform, queue, records, census: counts, hits: hitBits, views } = storage
  const release = () => releaseStorage(storage)
  const layout = probeLayout(device)
  const bind = probeBinder(device, layout, {
    grid: uniform.buffer,
    queue,
    census: counts,
    hits: hitBits,
    ...views,
  })
  const parts = { cascades, pool, queue, records, uniform, counts }
  try {
    const passes = await buildPasses(device, layout, parts, views, hitBits)
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
  /** The probes an image traces, those never traced first (`resolveProbesPerFrame`). */
  probesPerFrame: number,
  /** The empty lists bound where no grid holds them (`DeferredPlaceholders.tiles`), and the light
   *  grid whose buffer holds the world grid's lists beside the view's. */
  noLists: GPUBuffer,
  tiles: () => GpuLightTiles | undefined = () => undefined,
) {
  const rig = await createProbeRig(device, bounds, lights, tiles)
  const { cascades, pool, uniform, marks, census } = rig
  const readbacks = [marks, rig.hits, census]
  const encoder = createProbeEncoder(rig, scene, lights, probesPerFrame, noLists)
  const restart = () => (encoder.restart(), marks.stale())
  const parts = { boxes: () => scene.boxes(), cascades, restart }
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
    /** The placements moved or arrived: the light grid and the reach re-placed, the series restarted,
     *  the cells the image reads marked again (`probeSync.ts`). Whether anything did. */
    sync: () => syncBounceProbes(parts),
    /** Probes alive holding nothing yet: zero once every cell the image reads holds light. */
    get unfilled() {
      return pool.unfilled
    },
    /** The marks that came back (how many, the cells of the last), and what the last census of the
     *  field that came back counted — none before the first (`census.ts`). */
    marked: marks.stats,
    counted: census.reading,
    uniform: uniform.buffer,
    /** The probes' atlas, the pool's layer and the table's, which the lit passes read; what it weighs
     *  (the snapshot weighs as much). */
    probes: rig.views.probes,
    probeBytes: atlasBytes(rig.extent),
    setIrradianceView: uniform.setIrradianceView,
    /** After the image's submit: its marks, the cells its rays hit and its census map. */
    submitted: () => readbacks.forEach((readback) => readback.submitted()),
    dispose: () => (readbacks.forEach((readback) => readback.dispose()), rig.release()),
  }
}
