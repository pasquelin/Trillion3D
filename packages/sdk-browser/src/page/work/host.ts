import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { PAGE_TASK_PROTOCOL, pageWorkerCount } from '../../../../sdk-core/src/page/taskContracts.ts'
import { createPageWorkPool } from './pool.ts'
import { createWorkerLatch } from '../workerLatch.ts'
import { runPageTask } from './task.ts'
import { sha256Hex } from '../../streaming/sha256Hex.ts'
import { ownBuffer } from '../../../../sdk-core/src/runtime/ownBuffer.ts'
import type { PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'

const counters = { checked: 0, checkMs: 0 }
let admissionLimit = 1

/** Bounds the pool to the admission already in force for page transfers. Call before the
 *  first task; a later call does not resize an already-open pool. */
export function configurePageWorkers(limit: number) {
  admissionLimit = limit
}

/** The pool, made by its first task where a `Worker` exists, sized by the cores and the
 *  admission; latched broken once it dies (`createWorkerLatch`). */
const pool = createWorkerLatch(() => {
  if (typeof Worker === 'undefined') return undefined
  const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)
    ?.hardwareConcurrency
  return createPageWorkPool(pageWorkerCount(cores, admissionLimit))
})

/**
 * SHA-256 digest of freshly read page bytes, taken where they landed: `crypto.subtle` hashes off
 * the main thread already, so the bytes are neither transferred to a worker nor copied.
 */
export async function verifyPageBytes(source: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const started = cpuNow()
  const sha256 = await sha256Hex(source)
  counters.checked++
  counters.checkMs += msSince(started)
  return sha256
}

/**
 * A task that is never urgent — a `cut`, a partition's `cells` or `cellPage` (#575) — in a worker
 * while the pool lives, else by the same task on the main thread. The worker receives a copy of
 * `source`, so a vanished worker leaves it whole for the main thread.
 */
export async function patientTask(
  op: 'cut' | 'cells' | 'cellPage',
  source: Uint8Array,
  name?: string,
) {
  const open = pool.open()
  const answer = open ? await open.submit(op, source.slice().buffer as ArrayBuffer, name) : null
  if (answer && !(!answer.ok && answer.code === 'PAGE_TASK_WORKER')) return answer
  const request = { protocol: PAGE_TASK_PROTOCOL, id: 0, op, name }
  return (await runPageTask({ ...request, source: ownBuffer(source) })).answer
}

/** Drawn triangles, packed by `packDrawn`, cut into pages (`patientTask`). **The caller yields
 *  its buffer.** */
export async function cutPagesOffThread(packed: ArrayBuffer): Promise<PageCutPayload> {
  const answer = await patientTask('cut', new Uint8Array(packed))
  if (!answer.ok || !answer.cut) throw new Error(answer.ok ? 'PAGE_TASK_FAILED' : answer.message)
  return answer.cut
}

/** Pages checked, their cumulative digest time, and the pool's size (0 once it broke, `null`
 *  before it opened). `null` counts when nothing was checked: an unmeasured metric is not a zero. */
export function pageWorkStats() {
  const held = pool.held
  const workers = held?.alive ? held.workers : held || pool.broken ? 0 : null
  if (!counters.checked) return { checked: null, checkMs: null, workers }
  return { checked: counters.checked, checkMs: counters.checkMs, workers }
}

/** Closes the pool without cutting an in-flight task and resets counters to unmeasured. */
export function releasePageWorkers() {
  pool.release()
  counters.checked = 0
  counters.checkMs = 0
}
