import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { PAGE_TASK_PROTOCOL, pageWorkerCount } from '../../../../sdk-core/src/page/taskContracts.ts'
import { createPageWorkPool } from './pool.ts'
import { createWorkerLatch } from '../pages/workerLatch.ts'
import { runPageTask } from './task.ts'
import { sha256Hex } from '../streaming/sha256Hex.ts'
import {
  doubtfulArrays,
  type Measured,
} from '../../../../sdk-core/src/lighting/distanceFieldGpu.ts'
import { ownBuffer } from '../../../../sdk-core/src/runtime/ownBuffer.ts'
import type {
  PageCutPayload,
  PageTaskBlocks,
  PageTaskField,
  PageTaskOp,
} from '../../../../sdk-core/src/page/taskContracts.ts'

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
 * A task that is never urgent — a `cut`, a partition's `cells` or `cellPage` (#575), a texture
 * tile's `blocks` — in a worker while the pool lives, else by the same task on the main thread.
 * The worker receives a copy of `source`, so a vanished worker leaves it whole for the main
 * thread.
 */
export async function patientTask(
  op: PageTaskOp,
  source: Uint8Array,
  name?: string,
  blocks?: PageTaskBlocks,
  field?: PageTaskField,
) {
  const open = pool.open()
  const copy = () => source.slice().buffer as ArrayBuffer
  const answer = open ? await open.submit(op, copy(), name, blocks, field) : null
  if (answer && !(!answer.ok && answer.code === 'PAGE_TASK_WORKER')) return answer
  const request = { protocol: PAGE_TASK_PROTOCOL, id: 0, op, name, blocks, field }
  return (await runPageTask({ ...request, source: ownBuffer(source) })).answer
}

/** A tile record's BC blocks decoded to RGBA8 off the main thread (`patientTask`), `width` ×
 *  `height` texels of whole blocks — BC5 when `twoChannel` (`materials/texture/blockDecode.ts`). */
export async function decodeBlocksOffThread(blocks: Uint8Array, surface: PageTaskBlocks) {
  const answer = await patientTask('blocks', blocks, undefined, surface)
  if (!answer.ok || !answer.texels) throw new Error(answer.ok ? 'PAGE_TASK_FAILED' : answer.message)
  return new Uint8Array(answer.texels)
}

/** Drawn triangles, packed by `packDrawn`, cut into pages (`patientTask`). **The caller yields
 *  its buffer.** */
export async function cutPagesOffThread(packed: ArrayBuffer): Promise<PageCutPayload> {
  const answer = await patientTask('cut', new Uint8Array(packed))
  if (!answer.ok || !answer.cut) throw new Error(answer.ok ? 'PAGE_TASK_FAILED' : answer.message)
  return answer.cut
}

/** The bytes of `view`, not copied. */
const bytesOf = (view: Float32Array) =>
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength)

/** The first CPU half of the distance field of a mesh made at run time (`prepareDistanceField`), in a worker where one lives: `positions`
 *  are its triangles, nine floats each. None for a mesh with no triangle to measure. */
async function planFieldOffThread(positions: Float32Array, doubleSided: boolean) {
  const answer = await patientTask('fieldPlan', bytesOf(positions), undefined, undefined, {
    doubleSided,
  })
  if (!answer.ok) throw new Error(answer.message)
  return answer.fieldPlan ?? undefined
}

/** The second half (`finishDistanceField`), in a worker where one lives: the voxels the device `measured`, the triangles the plan was made of. */
async function finishFieldOffThread(
  mesh: number,
  positions: Float32Array,
  doubleSided: boolean,
  { voxels, doubtful }: Measured,
) {
  const { at, settled } = doubtfulArrays(doubtful)
  const field = {
    doubleSided,
    mesh,
    voxels: voxels.buffer,
    doubtfulAt: at.buffer,
    doubtfulSettled: settled.buffer,
  }
  const answer = await patientTask('fieldFinish', bytesOf(positions), undefined, undefined, field)
  if (!answer.ok) throw new Error(answer.message)
  return answer.distanceField ?? undefined
}

/** The two CPU halves of a run-time mesh's distance field, in a worker where one lives (`runtimeFields.ts` puts the device between them). */
export const fieldTasks = { plan: planFieldOffThread, finish: finishFieldOffThread }

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
