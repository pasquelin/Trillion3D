import {
  BOUNCE_PROBES_PER_FRAME,
  BOUNCE_SETTINGS,
  bounceBatchOf,
  createBounceBudget,
  createBounceCascades,
  createBounceOccupancy,
  type BounceCascades,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts'
import { bounceGroup, bounceLayout, type BounceSlot } from './bindings.ts'
import { atlasBytes, probeAtlasExtent } from './atlas.ts'
import { ensureBounceFits } from './limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { createSnapshotFollow, type SnapshotFollow } from './snapshotFollow.ts'
import { createBounceSchedule } from './schedule.ts'
import { createProbeStorage } from './probeStorage.ts'
import { createGpuBounceSurface, type GpuBounceSurface } from './surface.ts'
import { syncBounceProbes } from './probeSync.ts'
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { BOUNCE_PASS } from '../stage/passLabels.ts'
import { createGpuLightTiles, type GpuLightTiles } from '../lighting/tiles/tiles.ts'
import { BOUNCE_LIGHT_LIST_BINDING } from './lightCellWgsl.ts'

/** Proxy, lights, queue, frozen probes, output and canonical surface cache — the three atlases
 *  of `atlas.ts` —, and the world grid's light lists (`BOUNCE_LIGHT_LIST_BINDING`). */
const PROBE_TYPES: BounceSlot[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'atlas-array',
  'atlas-array-out',
  'atlas',
]
PROBE_TYPES[BOUNCE_LIGHT_LIST_BINDING] = 'read-only-storage'

/**
 * The world grid's light lists, which the cache texels and the probe hits walk (`lightCellWgsl.ts`):
 * the light grid pass over the last cascade level's lattice (`createGpuLightTiles`, `world`),
 * encoded on a frame where the lights or that lattice changed — a still scene lists nothing again.
 */
function worldLightLists(device: GPUDevice, tiles: GpuLightTiles, lights: () => GPUBuffer) {
  const corner = new Float32Array(3)
  let listed: string | undefined
  return {
    tiles,
    /** A light changed: the lists are listed again at the next encode. */
    stale() {
      listed = undefined
    },
    /** The lists of `cascades`' last level over `count` lights, encoded when stale; `false` when
     *  the device holds no grid for them. */
    encode(encoder: GPUCommandEncoder, cascades: BounceCascades, count: number, frame: number) {
      const level = cascades.levels[cascades.levels.length - 1]
      const key = `${level.spacing}|${level.base.join(',')}|${count}`
      if (!tiles.ensureWorld(cascades.size, lights(), count)) return false
      if (key === listed) return true
      for (let axis = 0; axis < 3; axis++) corner[axis] = level.base[axis] * level.spacing
      tiles.updateWorld(corner, level.spacing)
      if (!tiles.encode(encoder, frame)) return false
      listed = key
      return true
    },
  }
}

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** Fixed-capacity cascades with bounded updates and session-owned moving geometry. */
export async function createGpuBounceProbes(
  device: GPUDevice,
  proxy: SceneProxy,
  /** The declared-light buffer, read at each encode: it is replaced when the scene outgrows it. */
  lights: () => GPUBuffer,
  budgetMs: number,
) {
  const cascades = createBounceCascades(proxy.bounds)
  const occupancy = createBounceOccupancy(proxy, cascades)
  const schedule = createBounceSchedule(cascades, occupancy)
  const budget = createBounceBudget(budgetMs)
  const extent = probeAtlasExtent(cascades.size, BOUNCE_SETTINGS.cascadeLevels)
  ensureBounceFits(device, proxy, extent, schedule.queue.byteLength)
  const { resident, uniform, queue, probes, snapshot, views, clearLevels } = createProbeStorage(
    device,
    proxy,
    cascades,
    schedule.queue.byteLength,
    extent,
  )
  const probeBytes = atlasBytes(extent)
  const { probes: probesView, snapshot: snapshotView } = views
  const release = () => {
    queue.destroy()
    uniform.dispose()
    probes.destroy()
    snapshot.destroy()
    resident.dispose()
  }
  let surface!: GpuBounceSurface
  let pipeline: GPUComputePipeline
  let group: GPUBindGroup
  let follow: SnapshotFollow
  let boundLights: GPUBuffer
  let layout: GPUBindGroupLayout
  let lists!: ReturnType<typeof worldLightLists>
  let boundLists: GPUBuffer | undefined
  /** The probe group, on the light buffer and the world lists of the moment. */
  const bind = () =>
    bounceGroup(
      device,
      layout,
      [
        uniform.buffer,
        resident.buffer,
        (boundLights = lights()),
        queue,
        snapshotView,
        probesView,
        surface.view,
        (boundLists = lists.tiles.buffer!),
      ],
      PROBE_TYPES,
    )
  try {
    lists = worldLightLists(device, await createGpuLightTiles(device, 'world'), lights)
    surface = await createGpuBounceSurface(device, resident, lights, {
      uniform: uniform.buffer,
      snapshot: snapshotView,
    })
    const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE')
    layout = bounceLayout(device, PROBE_TYPES)
    pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    })
    follow = await createSnapshotFollow(device, uniform.buffer, queue, probesView, snapshotView)
  } catch (error) {
    surface?.dispose()
    lists?.tiles.dispose()
    release()
    throw error
  }
  let clearOwed = 0
  let generation = 1,
    frame = 0,
    updates = 0
  /** Posed hits read the surface cache, and its pass keeps owned triangles at their pose: the
   *  series closes when both sweeps have. */
  const rounds = () => Math.min(schedule.sweeps, surface.sweeps)
  /** True while the bounce series is not closed: beyond that, nothing more is encoded. */
  const working = () => rounds() < BOUNCE_SETTINGS.settledSweeps
  const batch = () => bounceBatchOf(BOUNCE_PROBES_PER_FRAME, budget.load)
  const restart = () => {
    generation++
    schedule.restart()
    surface.restart()
    lists.stale()
  }
  const invalidate = (levels: number) => void (clearOwed |= levels)
  const parts = { resident, cascades, occupancy, invalidate, restart }
  return {
    /** Moved, settled or nothing (`probeSync.ts`). */
    sync(worldOf: (source: number) => ArrayLike<number> | undefined) {
      return syncBounceProbes(parts, worldOf)
    },
    /** Owned leaves wait for their still streak to settle (`proxyMotion.ts`). */
    get settling() {
      return resident.settling
    },
    cascades,
    occupancy,
    budget,
    surface,
    proxy: resident,
    uniform: uniform.buffer,
    /** The probes' atlas, one layer per level, which the lit passes read. */
    probes: probesView,
    /** What the probes' atlas weighs; the snapshot weighs as much. */
    probeBytes,
    /** Frames of a full round, measured: that is the bound on convergence lag. */
    get sweepFrames() {
      return Math.max(schedule.sweepFrames, surface.sweepFrames, 1)
    },
    /** Probes the occupancy map keeps at the finest level, on its cells. */
    get activeProbes() {
      return occupancy.marked
    },
    get lastProbes() {
      return updates
    },
    /** Source radiance version for consumers with independent temporal histories. */
    get encodedFrames() {
      return frame
    },
    get lastRays() {
      return updates * BOUNCE_SETTINGS.raysPerProbe
    },
    get working() {
      return working()
    },
    observeGpuMs(ms: number | null) {
      budget.observe(ms)
    },
    setIrradianceView: uniform.setIrradianceView,
    /** A light changed: sweeps restart, sleeping probes wake. */
    restart,
    /**
     * Encodes a cache round then a probe batch. Returns `false` when there was nothing to do:
     * the scene is still, the series is closed, and the « Bounce » stage is « unmeasured ».
     */
    encode(encoder: GPUCommandEncoder, lightsActive: number, viewpoint: ArrayLike<number>) {
      updates = 0
      clearLevels(encoder, clearOwed)
      clearOwed = 0
      // Stopped as the proxy counts it: motion slower than the frame rate rebuilds no map per cycle.
      if (!resident.settling) occupancy.settle(resident.triangleBoxes, resident.bounds)
      if (cascades.follow(viewpoint)) schedule.restart()
      if (!cascades.probes || !lightsActive || !working()) return false
      // The world lists before the pass that reads them, listed again only when a light or the
      // last level changed.
      if (!lists.encode(encoder, cascades, lightsActive, frame)) return false
      if (lights() !== boundLights || lists.tiles.buffer !== boundLists) group = bind()
      frame++
      const groups = schedule.plan(batch())
      if (groups) device.queue.writeBuffer(queue, 0, schedule.queue, 0, groups)
      uniform.write(generation, groups, frame)
      // One pass: the surface cache's sweep, then the probes' update, which reads the cache, then
      // the snapshot's follow-up. The snapshot equals the probes here — the last update's texels
      // followed it, and a clear clears both —: the sweep reads it, then the update does.
      const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
      surface.encode(pass, budget.load, lists.tiles.buffer!)
      if (groups) {
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, group)
        pass.dispatchWorkgroups(groups, 1, 1)
        follow(pass, groups)
      }
      pass.end()
      updates = groups
      return true
    },
    /** Requests mapping of the world lists' pool sample, once its frame is submitted. */
    submitted() {
      lists.tiles.submitted()
    },
    dispose() {
      surface.dispose()
      lists.tiles.dispose()
      release()
    },
  }
}
