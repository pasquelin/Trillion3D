import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import { createReadbackRing, type ReadbackRing } from '../../gpu/core/readbackRing.ts'
import { rootSource } from '../../placement/hidden.ts'
import { VIS_TRIANGLE_BITS } from '../../visibility/visWords.ts'
import type { Intersection, RayFilter } from '../../world/query/types.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { rayFilterRanks } from './rayFilter.ts'
import { createRayQuery, type RayQuery } from './rayQuery.ts'
import { RAY_QUERY_PASS } from './rayQueryPass.ts'
import { raySourcesOf } from './raySources.ts'
import { validationScope } from '../../gpu/core/errorScope.ts'
import { log } from '../../diagnostic/log.ts'
import { RAY_HIT, RAY_RECORD, RAY_REACH_MAX, readHit, writeRay } from './rayRecord.ts'
import { createRayRecords } from './rayRecords.ts'

/** One ray cast and not answered yet: its doubles, its filter and its promise's settlement. */
type Ask = {
  origin: [number, number, number]
  direction: [number, number, number]
  reach: number
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
  let scheduled = false
  const query: RayQuery = createRayQuery(device),
    records = createRayRecords(rt)
  const settleAll = (batch: readonly Ask[], hits?: ArrayBuffer) => {
    const words = hits && new Uint32Array(hits),
      floats = hits && new Float32Array(hits)
    batch.forEach((ask, k) =>
      ask.settle(
        words ? intersectionOf(rt, ask, readHit(words, floats!, k * RAY_HIT.words)) : null,
      ),
    )
  }
  const schedule = () => {
    if (scheduled || !asks.length) return
    scheduled = true
    queueMicrotask(flush)
  }
  const ring: ReadbackRing<Batch> = createReadbackRing<Batch>(
    device,
    {
      label: 'Trillion3D ray hits',
      bytes: BATCH_RAYS * RAY_HIT.words * 4,
      count: RING_BUFFERS,
      // Each batch's mapping, awaited behind the device's verdict on it: a refused one answers no hit.
      chain: (read, batch) =>
        void batch.judged
          .then(read)
          .catch(() => settleAll(batch.asks))
          .finally(() => (flying.delete(batch), schedule())),
    },
    // A refused command buffer copied nothing: its staging buffer's words are another batch's.
    (mapped, _staging, batch) => settleAll(batch.asks, batch.refused ? undefined : mapped),
  )
  function flush() {
    scheduled = false
    if (!asks.length) return
    const sources = raySourcesOf(rt, records)
    if (!sources) return settleAll(asks.splice(0))
    if (!query.compiled(schedule, refused)) return
    let judge!: () => void
    const batch: Batch = {
      asks: asks.splice(0, BATCH_RAYS),
      judged: new Promise<void>((resolve) => (judge = resolve)),
      refused: false,
    }
    const staging = ring.take(batch, batch.asks.length * RAY_HIT.words * 4)
    // Every staging buffer in flight: the batch waits, and a landing calls the queue again.
    if (!staging) return void asks.unshift(...batch.asks)
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
          settleAll(batch.asks)
        },
      )
      .finally(judge)
  }
  /** The kernels refused: every ray waiting answers none, and the device's reason is said. */
  function refused(error: unknown) {
    log.error(`${RAY_QUERY_PASS} kernels refused:`, error)
    settleAll(asks.splice(0))
  }
  return {
    /** The nearest drawn triangle `ray` meets within `reach`, of the objects `filter` lets it meet:
     *  a promise its batch's landing settles. */
    cast(ray: Ray, filter?: RayFilter, reach = RAY_REACH_MAX): Promise<Intersection | null> {
      const { ranks, include } = rayFilterRanks(rt.layout, filter)
      if (include && !ranks.length) return Promise.resolve(null)
      const { origin: o, direction: d } = ray
      return new Promise((settle) => {
        asks.push({
          origin: [o.x, o.y, o.z],
          direction: [d.x, d.y, d.z],
          reach: Math.min(reach, RAY_REACH_MAX),
          ranks,
          include,
          settle,
        })
        schedule()
      })
    },
    /** Packed page `page`'s address took a slot, moved or left the pool: its record reads it
     *  again on the cache (`rayRecords.ts`). */
    moved: records.moved,
    /** Every ray cast answers none, and the queue's buffers are given back. */
    dispose() {
      settleAll(asks.splice(0))
      for (const batch of flying) settleAll(batch.asks)
      flying.clear()
      ring.destroy()
      query.dispose()
    },
  }
}
export type RayQueue = ReturnType<typeof createRayQueue>
