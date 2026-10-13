import {
  BOUNCE_PROBES_PER_FRAME,
  BOUNCE_SETTINGS,
  bounceBatchOf,
  createBounceBudget,
  createBounceCascades,
  createBounceOccupancy,
  type BounceCascades,
} from '../../../sdk-core/src/index.ts'
import { bounceGroup, bounceLayout, type BounceSlot } from './bindings.ts'
import { atlasBytes, probeAtlasExtent } from './atlas.ts'
import { ensureBounceFits } from './limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { createSnapshotFollow, type SnapshotFollow } from './snapshotFollow.ts'
import { createBounceSchedule } from './schedule.ts'
import { createProbeStorage } from './probeStorage.ts'
import { syncBounceProbes, type ProxyBoxes } from './probeSync.ts'
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { BOUNCE_PASS } from '../stage/passLabels.ts'
import type { GpuLightTiles } from '../lighting/tiles/tiles.ts'
import { BOUNCE_LIGHT_LIST_BINDING } from './lightCellWgsl.ts'

/** Cascade uniform, the proxy, lights, queue, frozen probes and output — the atlases of `atlas.ts` —, and the
 *  world grid's light lists (`BOUNCE_LIGHT_LIST_BINDING`). */
const PROBE_TYPES: BounceSlot[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'atlas-array',
  'atlas-array-out',
]
PROBE_TYPES[BOUNCE_LIGHT_LIST_BINDING] = 'read-only-storage'

/**
 * The world grid's light lists, which the cache texels and the probe and reflection hits walk
 * (`lightCellWgsl.ts`): the light grid's world pass over the last cascade level's lattice
 * (`createGpuLightTiles`), in the buffer every reader of a list binds, encoded on a frame where the
 * lights, that lattice or the buffer changed — a still scene lists nothing again. Their start goes to
 * the cascades' uniform (`setLightLists`); without a grid, none, and every point walks every light.
 */
function worldLightLists(
  tiles: () => GpuLightTiles | undefined,
  lights: () => GPUBuffer,
  uniform: ReturnType<typeof createProbeStorage>['uniform'],
) {
  const corner = new Float32Array(3)
  let listed: string | undefined
  return {
    /** A light changed: the lists are listed again at the next encode. */
    stale() {
      listed = undefined
    },
    /** The lists of `cascades`' last level over `count` lights, encoded when stale: the buffer that
     *  holds them, or none. */
    encode(encoder: GPUCommandEncoder, cascades: BounceCascades, count: number, frame: number) {
      const grid = tiles()
      if (!grid?.ensureWorld(cascades.size, lights(), count)) {
        uniform.setLightLists(undefined)
        return undefined
      }
      const level = cascades.levels[cascades.levels.length - 1]
      const key = `${level.spacing}|${level.base.join(',')}|${count}|${grid.revision}`
      if (key !== listed) {
        for (let axis = 0; axis < 3; axis++) corner[axis] = level.base[axis] * level.spacing
        grid.updateWorld(corner, level.spacing)
        listed = grid.encodeWorld(encoder, frame) ? key : undefined
      }
      uniform.setLightLists(listed ? grid.worldStart : undefined)
      return grid.buffer
    },
  }
}

/** What the probes read of the scene's proxy (`gpu/dag/proxyInstances.ts`, through the selection): the buffer
 *  its rays are traced through, when a placement wears a proxy, and the world boxes of the placements
 *  that do, which the occupancy map keeps. */
export type ProbeScene = {
  buffer(): GPUBuffer | undefined
  boxes(): ProxyBoxes
}

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>

/** Fixed-capacity cascades with bounded updates, tracing the scene's proxy wherever its placements stand. */
export async function createGpuBounceProbes(
  device: GPUDevice,
  /** The extent of the scene's placements: three lower bounds then three upper. */
  bounds: readonly number[],
  scene: ProbeScene,
  /** The declared-light buffer, read at each encode: it is replaced when the scene outgrows it. */
  lights: () => GPUBuffer,
  budgetMs: number,
  /** The light grid, whose buffer holds the world grid's lists beside the view's. */
  tiles: () => GpuLightTiles | undefined = () => undefined,
) {
  const first = scene.boxes()
  const cascades = createBounceCascades(bounds)
  const occupancy = createBounceOccupancy(bounds, first.boxes, cascades)
  const schedule = createBounceSchedule(cascades, occupancy)
  const budget = createBounceBudget(budgetMs)
  const extent = probeAtlasExtent(cascades.size, BOUNCE_SETTINGS.cascadeLevels)
  ensureBounceFits(device, extent, schedule.queue.byteLength)
  const { uniform, queue, probes, snapshot, views, clearLevels } = createProbeStorage(
    device,
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
  }
  let pipeline: GPUComputePipeline
  let group: GPUBindGroup | undefined
  let follow: SnapshotFollow
  let boundLights: GPUBuffer
  let bound: GPUBuffer | undefined
  let layout: GPUBindGroupLayout
  const lists = worldLightLists(tiles, lights, uniform)
  // The lists' stand-in where no grid holds them: no point reads it (`setLightLists`).
  const noLists = device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE })
  let boundLists: GPUBuffer = noLists
  /** The probe group, on the light buffer, the proxy buffer and the world lists of the moment (a growth of
   *  the proxy's tables replaces its buffer); none while no placement wears a proxy. */
  const bind = () => {
    const meshes = scene.buffer()
    if (!meshes) return (group = undefined)
    bound = meshes
    return (group = bounceGroup(
      device,
      layout,
      [
        uniform.buffer,
        meshes,
        (boundLights = lights()),
        queue,
        snapshotView,
        probesView,
        boundLists,
      ],
      PROBE_TYPES,
    ))
  }
  try {
    const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE')
    layout = bounceLayout(device, PROBE_TYPES)
    pipeline = await buildComputePipeline(device, {
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    })
    follow = await createSnapshotFollow(device, uniform.buffer, queue, probesView, snapshotView)
  } catch (error) {
    noLists.destroy()
    release()
    throw error
  }
  let clearOwed = 0
  let generation = 1,
    frame = 0,
    updates = 0
  /** The boxes and extent of the last sync: what the occupancy map rebuilds from once the placements rest. */
  let boxes = first.boxes,
    placed = bounds
  /** True while the bounce series is not closed: beyond that, nothing more is encoded. */
  const working = () => schedule.sweeps < BOUNCE_SETTINGS.settledSweeps
  const batch = () => bounceBatchOf(BOUNCE_PROBES_PER_FRAME, budget.load)
  const restart = () => {
    generation++
    schedule.restart()
    lists.stale()
  }
  const invalidate = (levels: number) => void (clearOwed |= levels)
  const parts = { boxes: () => scene.boxes(), cascades, occupancy, invalidate, restart }
  return {
    /** The placements moved or arrived: the cascades replanned, their cells marked, the series restarted
     *  (`probeSync.ts`). Whether anything did. */
    sync() {
      const change = syncBounceProbes(parts)
      if (change) ({ boxes, extent: placed } = change)
      return !!change
    },
    cascades,
    occupancy,
    budget,
    uniform: uniform.buffer,
    /** The probes' atlas, one layer per level, which the lit passes read. */
    probes: probesView,
    /** What the probes' atlas weighs; the snapshot weighs as much. */
    probeBytes,
    /** Frames of a full round, measured: that is the bound on convergence lag. */
    get sweepFrames() {
      return Math.max(schedule.sweepFrames, 1)
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
     * Encodes a probe batch. Returns `false` when there was nothing to do: the scene is still, the
     * series is closed, no placement wears a proxy to trace, and the « Bounce » stage is « unmeasured ».
     */
    encode(encoder: GPUCommandEncoder, lightsActive: number, viewpoint: ArrayLike<number>) {
      updates = 0
      clearLevels(encoder, clearOwed)
      clearOwed = 0
      const meshes = scene.buffer()
      occupancy.settle(boxes, placed)
      if (cascades.follow(viewpoint)) schedule.restart()
      // The world lists before every pass that reads them — this one, the reflections, the
      // blends —, listed again only when a light, the last level or the grid's buffer changed.
      const listing =
        cascades.probes && lightsActive
          ? lists.encode(encoder, cascades, lightsActive, frame)
          : undefined
      if (!meshes || !cascades.probes || !lightsActive || !working()) return false
      if (meshes !== bound || lights() !== boundLights || (listing ?? noLists) !== boundLists) {
        boundLists = listing ?? noLists
        bind()
      }
      frame++
      const groups = schedule.plan(batch())
      if (groups) device.queue.writeBuffer(queue, 0, schedule.queue, 0, groups)
      uniform.write(generation, groups, frame)
      // One pass: the probes' update, then the snapshot's follow-up. The snapshot equals the probes here — the
      // last update's texels followed it, and a clear clears both —: the update reads it.
      const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
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
    dispose() {
      noLists.destroy()
      release()
    },
  }
}
