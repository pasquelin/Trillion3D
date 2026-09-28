/**
 * Out of memory on WebGL2, absorbed (#483 rule 5, 8), without ever holding the main thread (#840).
 * WebGL2 reports a refused allocation only through `getError`, and `getError` waits for the GPU
 * process to run every command sent before it: read after each upload, it held the frame that
 * streamed pages in for the whole upload (a 100–140 ms hitch on sponza `rue`). So an allocation is
 * only recorded (`allocated`), with what to redo if it was refused. The host frame fences them once
 * its commands are sent (`fenceAllocations`), and the next frame reads the errors before sending
 * any command, only when that fence is passed (`settleAllocations`): nothing is left to wait for. An `OUT_OF_MEMORY` redoes every allocation not
 * yet confirmed and marks the context; the engine's next frame takes the mark (`takeOutOfMemory`)
 * and draws one level coarser (`../../backend/autonomous/pool.ts`, `outOfMemory`).
 */

/** What to redo when an allocation was refused; nothing for an allocation made once. */
type Redo = () => void;

/** A context's allocations not yet confirmed: sent before its fence, and since. */
type Unconfirmed = { fenced: Redo[]; pending: Redo[]; fence: WebGLSync | null };

const unconfirmed = new WeakMap<WebGL2RenderingContext, Unconfirmed>();

/** Contexts that refused an allocation since their engine's last frame. */
const refused = new WeakSet<WebGL2RenderingContext>();

/** Error flags a context can hold at once: the read stops there even on a driver that never
 *  clears one. */
const MAX_FLAGS = 8;

const nothing: Redo = () => {};

/** Records the allocation just sent on `gl`; `redo` runs if a later read finds it refused. */
export function allocated(gl: WebGL2RenderingContext, redo: Redo = nothing) {
  let state = unconfirmed.get(gl);
  if (!state) unconfirmed.set(gl, (state = { fenced: [], pending: [], fence: null }));
  state.pending.push(redo);
}

/** Reads the errors `gl` holds, now: true when one was `OUT_OF_MEMORY`, and then every allocation
 *  not yet confirmed is redone — the flag read here is theirs too, never read again. Other errors
 *  are cleared unchanged: they are not the allocation's to answer. Only a one-time build that
 *  already reads the context back (a framebuffer's status) calls it directly. */
export function refusedNow(gl: WebGL2RenderingContext) {
  let outOfMemory = false;
  for (let n = 0; n < MAX_FLAGS; n++) {
    const error = gl.getError();
    if (!error || error === gl.CONTEXT_LOST_WEBGL) break;
    if (error === gl.OUT_OF_MEMORY) outOfMemory = true;
  }
  if (!outOfMemory) return false;
  refused.add(gl);
  const state = unconfirmed.get(gl);
  if (state) {
    const redos = [...state.fenced, ...state.pending];
    state.fenced.length = state.pending.length = 0;
    for (const redo of redos) redo();
  }
  return true;
}

/** At the end of a frame's commands: fences every allocation not yet confirmed. The fence moves to
 *  each frame's end until one is passed: passed, it says the GPU ran every command of the context
 *  sent before the next frame, so the read that follows waits for none. */
export function fenceAllocations(gl: WebGL2RenderingContext | null | undefined) {
  const state = gl && unconfirmed.get(gl);
  if (!gl || !state || (!state.pending.length && !state.fenced.length)) return;
  if (state.fence) gl.deleteSync(state.fence);
  state.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!state.fence) return; // a lost context: nothing it holds is drawn again
  for (const redo of state.pending) state.fenced.push(redo);
  state.pending.length = 0;
}

/**
 * Before a frame's first command: once the fence of the last frame's end is passed, the errors
 * are read — the GPU process has nothing left to run before the read — and a refusal redoes every
 * allocation not yet confirmed. A fence not yet passed is never waited on.
 */
export function settleAllocations(gl: WebGL2RenderingContext | null | undefined) {
  const state = gl && unconfirmed.get(gl);
  if (!gl || !state?.fence || gl.getSyncParameter(state.fence, gl.SYNC_STATUS) !== gl.SIGNALED)
    return;
  gl.deleteSync(state.fence);
  state.fence = null;
  // Allocations sent since the fence may have been read too: a refusal redoes them with the rest.
  if (!refusedNow(gl)) state.fenced.length = 0;
}

/** Whether `gl` refused an allocation since the last call; the mark is cleared. */
export const takeOutOfMemory = (gl: WebGL2RenderingContext | null | undefined) =>
  !!gl && refused.delete(gl);
