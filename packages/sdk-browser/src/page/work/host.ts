import { PAGE_TASK_PROTOCOL, pageWorkerCount } from '../../../../sdk-core/src/page/taskContracts.ts'
import { createPageWorkPool, type PageWorkPool } from './pool.ts'
import { runPageTask } from './task.ts'
import { sha256Hex } from '../../streaming/sha256Hex.ts'
import type { PageCutPayload } from '../../../../sdk-core/src/page/taskContracts.ts'

const counters = { checked: 0, checkMs: 0 }
let admissionLimit = 1,
  pool: PageWorkPool | undefined,
  /** The pool broke once: its tasks run on the main thread for the rest of the session. */
  broken = false

/** Bounds the pool to the admission already in force for page transfers. Call before the
 *  first task; a later call does not resize an already-open pool. */
export function configurePageWorkers(limit: number) {
  admissionLimit = limit
}

/** The pool, opened by its first task; `undefined` where no `Worker` exists or once it broke: a
 *  pool broken after start does not come back, its workers are gone, and relaunching them on
 *  every task would turn a failure into a loop. */
function openPool() {
  if (broken || typeof Worker === 'undefined') return undefined
  if (pool && !pool.alive) {
    broken = true
    pool = undefined
    return undefined
  }
  if (!pool) {
    const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)
      ?.hardwareConcurrency
    pool = createPageWorkPool(pageWorkerCount(cores, admissionLimit))
  }
  return pool
}

/** A view's buffer, without a copy when the view covers it whole, and a copy otherwise: the task
 *  reads an `ArrayBuffer`, never a leftover shared buffer. */
function ownBuffer(bytes: Uint8Array) {
  return (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer
  ) as ArrayBuffer
}

/**
 * SHA-256 digest of freshly read page bytes, taken where they landed: `crypto.subtle` hashes off
 * the main thread already, so the bytes are neither transferred to a worker nor copied.
 */
export async function verifyPageBytes(source: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const started = performance.now()
  const sha256 = await sha256Hex(source)
  counters.checked++
  counters.checkMs += performance.now() - started
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
  const open = openPool()
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
  const workers = pool?.alive ? pool.workers : pool || broken ? 0 : null
  if (!counters.checked) return { checked: null, checkMs: null, workers }
  return { checked: counters.checked, checkMs: counters.checkMs, workers }
}

/** Closes the pool without cutting an in-flight task and resets counters to unmeasured. */
export function releasePageWorkers() {
  pool?.retire()
  pool = undefined
  broken = false
  counters.checked = 0
  counters.checkMs = 0
}
