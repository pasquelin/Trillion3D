import {
  BOUNCE_PROBES_PER_FRAME,
  BOUNCE_SETTINGS,
  bounceBatchOf,
  createBounceBudget,
  createBounceCascades,
  createBounceOccupancy,
} from '../../../sdk-core/src/index.ts'
import { bounceGroup, bounceLayout, type BounceSlot } from './bindings.ts'
import { atlasBytes, probeAtlasExtent } from './atlas.ts'
import { ensureBounceFits } from './limits.ts'
import { BOUNCE_PROBE_SHADER } from './probeWgsl.ts'
import { createSnapshotFollow, type SnapshotFollow } from './snapshotFollow.ts'
import { createBounceSchedule } from './schedule.ts'
import { createProbeStorage } from './probeStorage.ts'
import { syncBounceProbes } from './probeSync.ts'
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts'
import { buildComputePipeline } from '../lighting/deferred/fullscreen.ts'
import { BOUNCE_PASS } from '../stage/passLabels.ts'

/** Cascade uniform, the proxy, lights, queue, frozen probes, output and the world matrices the proxy is placed by:
 *  the atlases of `atlas.ts`. */
const PROBE_TYPES: BounceSlot[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'atlas-array',
  'atlas-array-out',
  'read-only-storage',
]

/** What the probes read of the scene's proxy (`gpu/dag/proxyInstances.ts`, through the selection): the two
 *  buffers its rays are traced through, when a placement wears a proxy, and the world boxes of the placements
 *  that do, which the occupancy map keeps. */
export type ProbeScene = {
  buffers(): { proxy: GPUBuffer; worlds: GPUBuffer } | undefined
  boxes(): { boxes: Float64Array; changed: Uint8Array }
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
  let bound: { proxy: GPUBuffer; worlds: GPUBuffer } | undefined
  let layout: GPUBindGroupLayout
  /** The probe group, on the light buffer and the proxy buffers of the moment (a growth of the proxy's tables
   *  replaces its buffer); none while no placement wears a proxy. */
  const bind = () => {
    const meshes = scene.buffers()
    if (!meshes) return (group = undefined)
    bound = meshes
    return (group = bounceGroup(
      device,
      layout,
      [
        uniform.buffer,
        meshes.proxy,
        (boundLights = lights()),
        queue,
        snapshotView,
        probesView,
        meshes.worlds,
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
    bind()
    follow = await createSnapshotFollow(device, uniform.buffer, queue, probesView, snapshotView)
  } catch (error) {
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
      const meshes = scene.buffers()
      if (
        meshes?.proxy !== bound?.proxy ||
        meshes?.worlds !== bound?.worlds ||
        lights() !== boundLights
      )
        bind()
      occupancy.settle(boxes, placed)
      if (cascades.follow(viewpoint)) schedule.restart()
      if (!group || !cascades.probes || !lightsActive || !working()) return false
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
      release()
    },
  }
}
