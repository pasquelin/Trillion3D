import type { BounceCascades } from '../../../../../sdk-core/src/bounce/cascades.ts'
import type { ProbePool } from '../../../../../sdk-core/src/bounce/probePool.ts'
import { BOUNCE_PASS } from '../../../diagnostic/stage/passLabels.ts'
import type { ProxyResources } from '../../../geometry/dag/cut/cutReaders.ts'
import type { createBounceCensus } from '../census.ts'
import type { createBounceMarks, MarkSurface } from '../marks.ts'
import type { createBounceSchedule } from '../schedule.ts'
import type { SnapshotFollow } from '../snapshotFollow.ts'
import type { createBounceUniform } from '../uniform.ts'
import type { worldLightLists } from '../worldLightLists.ts'
import type { probeBinder } from './probeGroup.ts'
import { PROBE_QUEUE_WORDS } from './probeQueueWgsl.ts'
import type { ProxyBoxes } from './probeSync.ts'
import type { TableWrite } from './tableWrite.ts'
import { TABLE_RECORD_WORDS } from './tableWgsl.ts'

/** What the probes read of the scene's proxy (`geometry/dag/proxy/proxyInstances.ts`, through the selection): what its
 *  rays are traced through, when a placement wears a proxy, and the extent of the placements that do,
 *  which the world light grid and the rays' reach are laid on. */
export type ProbeScene = {
  proxy(): ProxyResources | undefined
  boxes(): ProxyBoxes
}

/** What the encoding of an image works with: the levels, the pool and its schedule, the buffers and the pipelines of the pass. */
export type ProbeParts = {
  device: GPUDevice
  cascades: BounceCascades
  pool: ProbePool
  schedule: ReturnType<typeof createBounceSchedule>
  uniform: ReturnType<typeof createBounceUniform>
  queue: GPUBuffer
  records: GPUBuffer
  bind: ReturnType<typeof probeBinder>
  pipeline: GPUComputePipeline
  follow: SnapshotFollow
  table: TableWrite
  marks: Awaited<ReturnType<typeof createBounceMarks>>
  census: Awaited<ReturnType<typeof createBounceCensus>>
  /** The census's buffer: the update adds its counts to it. */
  counts: GPUBuffer
  lists: ReturnType<typeof worldLightLists>
}

/** The work of an image: whether it marks, the probes it queues, the texels of the table it writes and
 *  whether it counts the field after their update. */
type Work = {
  marking: boolean
  counting: boolean
  groups: number
  texels: number
}

/** The frame's queue, the table's records and the levels' uniform, written for the work in hand. */
function upload(parts: ProbeParts, work: Work, generation: number, frame: number) {
  const { device, schedule } = parts
  if (work.groups)
    device.queue.writeBuffer(parts.queue, 0, schedule.queue, 0, work.groups * PROBE_QUEUE_WORDS)
  if (work.texels)
    device.queue.writeBuffer(
      parts.records,
      0,
      schedule.records,
      0,
      (work.texels + 1) * TABLE_RECORD_WORDS,
    )
  parts.uniform.write(generation, work.groups, frame)
}

/** The bounce pass of an image: the cells it reads marked, the table's writes, the probes' update and its
 *  snapshot's follow-up — the snapshot equals the probes here, the last update's texels followed it: the
 *  update reads it — and the field's census. */
function encodePass(
  parts: ProbeParts,
  encoder: GPUCommandEncoder,
  group: GPUBindGroup,
  surface: MarkSurface | undefined,
  work: Work,
) {
  const { marks, table, pipeline, follow, census } = parts
  if (work.marking) marks.clear(encoder)
  if (work.counting) census.clear(encoder)
  const pass = encoder.beginComputePass({ label: BOUNCE_PASS })
  if (work.marking) marks.dispatch(pass, surface!)
  if (work.texels) table(pass, work.texels)
  if (work.groups) {
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, group)
    pass.dispatchWorkgroups(work.groups, 1, 1)
    follow(pass, work.groups)
    if (work.counting) census.dispatch(pass)
  }
  pass.end()
  if (work.marking) marks.copy(encoder)
  if (work.counting) census.copy(encoder)
}

/** What image `frame` traces, filled into `work`: the probes queued for an eye at `viewpoint`, the texels of
 *  the table to write and whether the field is counted after the update. */
function plan(
  parts: ProbeParts,
  work: Work,
  frame: number,
  viewpoint: ArrayLike<number>,
  probesPerFrame: number,
) {
  const { schedule, census } = parts
  work.groups = schedule.plan(frame, viewpoint, probesPerFrame)
  work.counting = work.groups > 0 && census.begin(frame)
  work.texels = schedule.texels
}

/**
 * The encoding of an image of probes: its marks and a probe batch, what the lit passes will read of them
 * and what the series says of itself. `generation` rises when the lights change: a sleeping probe
 * wakes; `frame` counts the images that encoded something, the clock of the pool.
 */
export function createProbeEncoder(
  parts: ProbeParts,
  scene: ProbeScene,
  lights: () => GPUBuffer,
  probesPerFrame: number,
  /** The empty lists bound where no grid holds them. */
  noLists: GPUBuffer,
) {
  const { cascades, pool, marks, lists } = parts
  let generation = 1,
    frame = 0
  /** The work of the image in hand, refilled each image: what the last one did when it is over. */
  const work: Work = { marking: false, counting: false, groups: 0, texels: 0 }
  return {
    /** A light changed: every probe is updated again, sleeping probes wake. */
    restart() {
      generation++
      pool.restart()
      lists.stale()
    },
    /** The series is open: a probe holding nothing or short of its updates, a texel of the table to
     *  write, a mark owed or in flight. */
    get working() {
      return pool.working || marks.pending
    },
    get lastProbes() {
      return work.groups
    },
    get lastTexels() {
      return work.texels
    },
    /** Encodes an image's marks (`surface`: what it drew) and a probe batch; `false` when there was
     *  nothing to do: the view still and marked, the series closed, no proxy to trace. */
    encode(
      encoder: GPUCommandEncoder,
      lightsActive: number,
      viewpoint: ArrayLike<number>,
      surface?: MarkSurface,
    ) {
      work.groups = work.texels = 0
      const proxy = scene.proxy()
      const slid = cascades.follow(viewpoint)
      if (slid) pool.slide()
      // The world lists before every pass that reads them — this one, the reflections, the
      // blends —, listed again only when a light, the lattice or the grid's buffer changed.
      const listing = lightsActive
        ? lists.encode(encoder, cascades, lightsActive, frame)
        : undefined
      if (!proxy || !lightsActive) return false
      work.marking = marks.begin(surface, frame + 1, slid)
      if (!work.marking && !pool.working) return false
      const group = parts.bind(proxy, lights(), listing ?? noLists)
      frame++
      plan(parts, work, frame, viewpoint, probesPerFrame)
      upload(parts, work, generation, frame)
      encodePass(parts, encoder, group, surface, work)
      return true
    },
  }
}
