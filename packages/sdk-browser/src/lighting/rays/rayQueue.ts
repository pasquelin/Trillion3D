import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'
import { rootSource } from '../../placement/hidden.ts'
import { VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import type { Intersection, RayFilter, RayReach } from '../../api/query/types.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { rayFilterRanks } from './rayFilter.ts'
import { createRayQuery, type RayQuery } from './rayQuery.ts'
import { RAY_QUERY_PASS } from './rayQueryPass.ts'
import { raySourcesOf } from './raySources.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import { log } from '../../diagnostic/log.ts'
import { RAY_HIT, RAY_RECORD, RAY_REACH_MAX, readHit, writeRay } from './rayRecord.ts'
import { createRayRecords } from './rayRecords.ts'
import { createDeferred } from '../../../../sdk-core/src/runtime/deferred.ts'
import { microtaskOnce } from '../../../../sdk-core/src/runtime/microtaskOnce.ts'

/** One ray cast and not answered yet: its doubles, its bounds, its filter and its promise's
 *  settlement. */
type Ask = {
  origin: [number, number, number]
  direction: [number, number, number]
  reach: number
  lineReach: number
  ranks: number[]
  include: boolean
  settle: (hit: Intersection | null) => void
}

/** One dispatch's rays, and the device's verdict on its command buffer: `judged` holds once the
 *  validation scope closed, `refused` when it caught an error — the copy never ran, and the staging
 *  buffer still holds an older batch's hits. */
type Batch = { asks: Ask[]; judged: Promise<void>; refused: boolean }

/** Rays one dispatch traces at most: a batch past it waits for the next. */
const BATCH_RAYS = 1024
/** Staging buffers the answers come back through: a batch a frame, three in flight. */
const RING_BUFFERS = 3

/** The batch's words: each ray's record (`rayRecord.ts`), then their filter lists. */
function packBatch(asks: readonly Ask[]) {
  const filterWord = asks.length * RAY_RECORD.words
  const listed = asks.reduce((sum, ask) => sum + ask.ranks.length, 0)
  const words = new Uint32Array(filterWord + Math.max(1, listed)),
    floats = new Float32Array(words.buffer)
  let first = 0
  asks.forEach((ask, k) => {
    words.set(ask.ranks, filterWord + first)
    const filter = { filterFirst: first, filterCount: ask.ranks.length, include: ask.include }
    writeRay(words, floats, k * RAY_RECORD.words, { ...ask, ...filter })
    first += ask.ranks.length
  })
  return { words, rays: asks.length, filterWord }
}

/** The intersection a hit names, in the world's doubles: the node that drew the placement met — the
 *  mesh the page added, or the one owning the row that places it (`rootSource`) —, the point
 *  `origin + distance · direction`. A hit no node draws answers none. */
function intersectionOf(rt: WebgpuPagesRuntime, ask: Ask, hit: ReturnType<typeof readHit>) {
  const root = hit && rt.layout.selectionRoots[hit.placement]
  const object = root && rootSource(root)
  if (!hit || !object) return null
  const [o, d, t] = [ask.origin, ask.direction, hit.distance]
  return {
    object,
    point: new Vector3(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t),
    normal: new Vector3(hit.normal[0], hit.normal[1], hit.normal[2]),
    distance: t,
    face: hit.page * 2 ** VIS_TRIANGLE_BITS + hit.triangle,
  } satisfies Intersection
}

/** Every ask of `batch` settles to the intersection its hit names, or to none without `hits`. */
function settleAll(rt: WebgpuPagesRuntime, batch: readonly Ask[], hits?: ArrayBuffer) {
  const words = hits && new Uint32Array(hits),
    floats = hits && new Float32Array(hits)
  batch.forEach((ask, k) =>
    ask.settle(words ? intersectionOf(rt, ask, readHit(words, floats!, k * RAY_HIT.words)) : null),
  )
}

/** The ring of staging buffers the hits come back through. */
function createBatchRing(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  flying: Set<Batch>,
  schedule: () => void,
): ReadbackRing<Batch> {
  return createReadbackRing<Batch>(
    device,
    {
      label: 'Trillion3D ray hits',
      bytes: BATCH_RAYS * RAY_HIT.words * 4,
      count: RING_BUFFERS,
      // Each batch's mapping, awaited behind the device's verdict on it: a refused one answers no hit.
      chain: (read, batch) =>
        void batch.judged
          .then(read)
          .catch(() => settleAll(rt, batch.asks))
          .finally(() => (flying.delete(batch), schedule())),
    },
    // A refused command buffer copied nothing: its staging buffer's words are another batch's.
    (mapped, _staging, batch) => settleAll(rt, batch.asks, batch.refused ? undefined : mapped),
  )
}

/** What the queue holds between ticks. */
interface QueueState {
  readonly rt: WebgpuPagesRuntime
  readonly device: GPUDevice
  readonly asks: Ask[]
  readonly flying: Set<Batch>
  readonly query: RayQuery
  readonly records: ReturnType<typeof createRayRecords>
  readonly ring: ReadbackRing<Batch>
  readonly schedule: () => void
  readonly refused: (error: unknown) => void
}

/** The kernels refused: every ray waiting answers none, and the device's reason is said. */
function kernelsRefused(q: QueueState, error: unknown) {
  log.error(`${RAY_QUERY_PASS} kernels refused:`, error)
  settleAll(q.rt, q.asks.splice(0))
}

/** The device's verdict on a batch's command buffer, once its validation scope closed. */
function judgeBatch(
  q: QueueState,
  batch: Batch,
  staging: GPUBuffer,
  sources: NonNullable<ReturnType<typeof raySourcesOf>>,
  judge: () => void,
) {
  const { rt, device, query, ring, flying, schedule } = q
  // In a validation scope: a batch the device refuses says why and answers no hit.
  void validationScope(device, () => {
    const encoder = device.createCommandEncoder({ label: RAY_QUERY_PASS })
    const hits = query.encode(encoder, sources, packBatch(batch.asks))
    encoder.copyBufferToBuffer(hits.buffer, hits.offset, staging, 0, hits.bytes)
    device.queue.submit([encoder.finish()])
    flying.add(batch)
    ring.submitted(staging)
    schedule()
  })
    .then(
      ({ error }) => {
        batch.refused = error !== null
        if (error) log.error(`${RAY_QUERY_PASS} refused: ${error.message}`)
      },
      // A device that refuses the batch — lost under it — answers none of its rays.
      () => {
        batch.refused = true
        ring.dropped(staging)
        settleAll(rt, batch.asks)
      },
    )
    .finally(judge)
}

/** Traces the rays waiting, up to a batch of them, in one dispatch. */
function flushQueue(q: QueueState) {
  const { rt, asks, query, records, ring } = q
  if (!asks.length) return
  const sources = raySourcesOf(rt, records)
  if (!sources) return settleAll(rt, asks.splice(0))
  if (!query.compiled(q.schedule, q.refused)) return
  const { promise: judged, resolve: judge } = createDeferred<void>()
  const batch: Batch = {
    asks: asks.splice(0, BATCH_RAYS),
    judged,
    refused: false,
  }
  const staging = ring.take(batch, batch.asks.length * RAY_HIT.words * 4)
  // Every staging buffer in flight: the batch waits, and a landing calls the queue again.
  if (!staging) return void asks.unshift(...batch.asks)
  judgeBatch(q, batch, staging, sources, judge)
}

/**
 * THE RAYS CAST AT ONE SESSION'S ENGINE (`Engine.castRay`): each ray is queued with its promise, and
 * the queue is traced at the next tick, every ray of it in one dispatch of a command buffer of its
 * own (`rayQuery.ts`), so a held frame delays none. Its hits come back through the engine's one ring
 * of staging buffers (`createReadbackRing`), mapped once the GPU ran them — a frame later, the main
 * thread never waiting —, and each promise settles to the intersection its hit names. While every
 * staging buffer is in flight, or a kernel compiles, the rays wait their turn; a session that cannot
 * trace — opening, lost, disposed — answers none.
 */
export function createRayQueue(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const asks: Ask[] = [],
    flying = new Set<Batch>()
  const turn = microtaskOnce(() => flushQueue(q))
  const schedule = () => {
    if (asks.length) turn.schedule()
  }
  const q: QueueState = {
    rt,
    device,
    asks,
    flying,
    query: createRayQuery(device),
    records: createRayRecords(rt),
    ring: createBatchRing(rt, device, flying, schedule),
    schedule,
    refused: (error) => kernelsRefused(q, error),
  }
  return {
    /** The nearest drawn triangle `ray` meets within `reach` — or line it passes within
     *  `lineReach` of, none unset —, of the objects `filter` lets it meet: a promise its batch's
     *  landing settles. */
    cast(
      ray: Ray,
      filter?: RayFilter,
      { reach = RAY_REACH_MAX, lineReach = 0 }: RayReach = {},
    ): Promise<Intersection | null> {
      const { ranks, include } = rayFilterRanks(rt.layout, filter)
      if (include && !ranks.length) return Promise.resolve(null)
      const { origin: o, direction: d } = ray
      return new Promise((settle) => {
        asks.push({
          origin: [o.x, o.y, o.z],
          direction: [d.x, d.y, d.z],
          reach: Math.min(reach, RAY_REACH_MAX),
          lineReach: Math.max(0, lineReach),
          ranks,
          include,
          settle,
        })
        schedule()
      })
    },
    /** Packed page `page`, its primitive page's least rank, took a slot, moved or left the pool:
     *  its record reads it again on the cache (`rayRecords.ts`). */
    moved: q.records.moved,
    /** Every ray cast answers none, and the queue's buffers are given back. */
    dispose() {
      settleAll(rt, asks.splice(0))
      for (const batch of flying) settleAll(rt, batch.asks)
      flying.clear()
      q.ring.destroy()
      q.query.dispose()
    },
  }
}
export type RayQueue = ReturnType<typeof createRayQueue>
