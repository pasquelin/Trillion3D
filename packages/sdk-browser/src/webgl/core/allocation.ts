/**
 * Out of memory on WebGL2, absorbed (#483 rule 5, 8), without ever holding the main thread (#840).
 * WebGL2 reports a refused allocation only through `getError`, and `getError` waits for the GPU
 * process to run every command sent before it: read after each upload, it held the frame that
 * streamed pages in for the whole upload (a 100–140 ms hitch on sponza `rue`). So an allocation is
 * only recorded (`allocated`), with its pool and what to redo if it was refused. The host frame
 * fences what it allocated once its commands are sent (`fenceAllocations`), one batch per frame:
 * a batch keeps its fence until the GPU passes it, however far behind the GPU runs. The next frame
 * reads the errors before sending any command, only once the oldest fence is passed
 * (`settleAllocations`). An `OUT_OF_MEMORY` redoes every allocation not yet confirmed and marks
 * their pools; the engine's next frame takes each mark (`takeOutOfMemory`) and draws that pool one
 * level coarser (`../../backend/autonomous/pool.ts`, `outOfMemory`).
 */
import type { RefusedPool } from '../../residency/outOfMemory.ts'

/** What to redo when an allocation was refused; nothing for an allocation made once. */
type Redo = () => void

/** An allocation not yet confirmed: its pool and what to redo. */
type Sent = { pool: RefusedPool; redo: Redo }

/** Allocations one frame sent, behind the fence placed at its end. */
type Batch = { fence: WebGLSync; sent: Sent[] }

/** A context's allocations not yet confirmed — the fenced batches, oldest first, and those sent
 *  since the last fence — and the pools it refused an allocation of since its engine's last
 *  frame. */
type Unconfirmed = { batches: Batch[]; pending: Sent[]; refused: Set<RefusedPool> }

const unconfirmed = new WeakMap<WebGL2RenderingContext, Unconfirmed>()

/** Error flags a context can hold at once: the read stops there even on a driver that never
 *  clears one. */
const MAX_FLAGS = 8

const nothing: Redo = () => {}

const stateOf = (gl: WebGL2RenderingContext) => {
  let state = unconfirmed.get(gl)
  if (!state) unconfirmed.set(gl, (state = { batches: [], pending: [], refused: new Set() }))
  return state
}

/** Records the allocation of `pool` just sent on `gl`; `redo` runs if a read finds it refused. */
export function allocated(gl: WebGL2RenderingContext, pool: RefusedPool, redo: Redo = nothing) {
  stateOf(gl).pending.push({ pool, redo })
}

/** Marks and redoes every allocation not yet confirmed: the flag read is any of theirs. */
function refuseAll(gl: WebGL2RenderingContext) {
  const state = stateOf(gl)
  const refuse = (one: Sent) => {
    state.refused.add(one.pool)
    one.redo()
  }
  for (const batch of state.batches) {
    gl.deleteSync(batch.fence)
    batch.sent.forEach(refuse)
  }
  state.pending.forEach(refuse)
  state.batches.length = state.pending.length = 0
}

/** Reads the errors `gl` holds, now: true when one was `OUT_OF_MEMORY`, and then every allocation
 *  not yet confirmed is redone — the flag read here is theirs too, never read again. Other errors
 *  are cleared unchanged: they are not the allocation's to answer. Only a one-time build that
 *  already reads the context back (a framebuffer's status) calls it directly. */
export function refusedNow(gl: WebGL2RenderingContext) {
  let outOfMemory = false
  for (let n = 0; n < MAX_FLAGS; n++) {
    const error = gl.getError()
    if (!error || error === gl.CONTEXT_LOST_WEBGL) break
    if (error === gl.OUT_OF_MEMORY) outOfMemory = true
  }
  if (outOfMemory) refuseAll(gl)
  return outOfMemory
}

/** At the end of a frame's commands: fences the allocations it sent as one batch. The batches
 *  before keep their fences: passed, each says the GPU ran every command sent before it. */
export function fenceAllocations(gl: WebGL2RenderingContext | null | undefined) {
  const state = gl && unconfirmed.get(gl)
  if (!gl || !state?.pending.length) return
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!fence) return // a lost context: nothing it holds is drawn again
  state.batches.push({ fence, sent: state.pending })
  state.pending = []
}

/**
 * Before a frame's first command: once the oldest fence is passed, the errors are read — the GPU
 * ran past it — and every batch whose fence is passed by then is confirmed; a refusal redoes every
 * allocation not yet confirmed instead. A fence not yet passed is never waited on, and never
 * replaced: a GPU several frames behind has its oldest batch read as soon as it catches up to it.
 */
export function settleAllocations(gl: WebGL2RenderingContext | null | undefined) {
  const state = gl && unconfirmed.get(gl)
  if (!gl || !state?.batches.length || !passed(gl, state.batches[0])) return
  // Allocations sent since the passed fences may have been read too: a refusal redoes them all.
  if (refusedNow(gl)) return
  let confirmed = 1
  gl.deleteSync(state.batches[0].fence)
  while (confirmed < state.batches.length && passed(gl, state.batches[confirmed]))
    gl.deleteSync(state.batches[confirmed++].fence)
  state.batches.splice(0, confirmed)
}

const passed = (gl: WebGL2RenderingContext, batch: Batch) =>
  gl.getSyncParameter(batch.fence, gl.SYNC_STATUS) === gl.SIGNALED

/** Whether `gl` refused an allocation of `pool` since the last call for it; the mark is cleared. */
export const takeOutOfMemory = (gl: WebGL2RenderingContext | null | undefined, pool: RefusedPool) =>
  !!gl && !!unconfirmed.get(gl)?.refused.delete(pool)
