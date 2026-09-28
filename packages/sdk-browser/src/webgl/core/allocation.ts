/**
 * Out of memory on WebGL2, absorbed (#483 rule 5, 8). WebGL2 reports a refused allocation only
 * through `getError`, never by throwing: unread, the frame goes on with a buffer or a texture that
 * holds nothing. Each allocation of the engine — a buffer or a texture level sized again, a target
 * resized — is followed by `allocated`, which reads the context's errors; an `OUT_OF_MEMORY` marks
 * the context, and the engine's next frame takes the mark (`takeOutOfMemory`) and draws one level
 * coarser (`../../backend/autonomous/pool.ts`, `outOfMemory`). Only allocations read the errors:
 * `getError` waits for the GPU process, and a frame that allocates nothing never calls it.
 */

/** Contexts that refused an allocation since their engine's last frame. */
const refused = new WeakSet<WebGL2RenderingContext>();

/** Error flags a context can hold at once: the read stops there even on a driver that never
 *  clears one. */
const MAX_FLAGS = 8;

/** Reads the errors the last allocation on `gl` left; false, and the context marked, when one was
 *  `OUT_OF_MEMORY`. Other errors are cleared unchanged: they are not the allocation's to answer. */
export function allocated(gl: WebGL2RenderingContext) {
  let outOfMemory = false;
  for (let n = 0; n < MAX_FLAGS; n++) {
    const error = gl.getError();
    if (!error || error === gl.NO_ERROR || error === gl.CONTEXT_LOST_WEBGL) break;
    if (error === gl.OUT_OF_MEMORY) outOfMemory = true;
  }
  if (outOfMemory) refused.add(gl);
  return !outOfMemory;
}

/** Whether `gl` refused an allocation since the last call; the mark is cleared. */
export const takeOutOfMemory = (gl: WebGL2RenderingContext | null | undefined) =>
  !!gl && refused.delete(gl);
