import type { PageRec } from '../../page/selection/selection.ts'

/** View-projection of the image as the GPU reads it, flattened: sixteen floats rewritten each
 *  image, never reallocated. */
export const viewProj = new Float64Array(16)

type DrawnMirror = {
  shown: PageRec[]
  shownPacked: number[]
  drawn: PageRec[]
  drawnPacked: number[]
  drawnMirrorsShown: boolean
}
type DrawnMirrorFlag = Pick<DrawnMirror, 'drawnMirrorsShown'>
/**
 * Sole owner of the `drawnMirrorsShown` flag: true when `drawn` is the copy of `shown` as it
 * stands. `drawn` is nothing else: adoption remakes it when the readback changes. These functions
 * are the only ones that write the flag, initial value included: nothing is copied yet, the first
 * image will do it.
 */
export const unmirroredDrawn = (): DrawnMirrorFlag => ({ drawnMirrorsShown: false })
/** `drawn` has just been remade from `shown` by the caller itself. */
export function markDrawnMirrored(run: DrawnMirrorFlag) {
  run.drawnMirrorsShown = true
}
/** Copies `source` into `target`, rank by rank: neither push, nor a prior clear. */
export function copyPages<T>(target: T[], source: readonly T[]) {
  for (let i = 0; i < source.length; i++) target[i] = source[i]
  target.length = source.length
}
/** The same for packed ranks, from a typed list: `target` takes `source`'s live length. A typed
 *  buffer is grown and never shrunk, so `count` names its live ranks when it is shorter (`#1235`). */
export function copyPacked(target: number[], source: ArrayLike<number>, count = source.length) {
  for (let i = 0; i < count; i++) target[i] = source[i]
  target.length = count
}
/** Remakes `drawn` from `shown`, whether the flag is raised or not. */
function copyDrawnFromShown(run: DrawnMirror) {
  copyPages(run.drawn, run.shown)
  copyPages(run.drawnPacked, run.shownPacked)
  markDrawnMirrored(run)
}
/** Remakes `drawn` from `shown` if it is no longer the copy of it; returns true if it did. */
export function mirrorDrawnFromShown(run: DrawnMirror) {
  if (run.drawnMirrorsShown) return false
  copyDrawnFromShown(run)
  return true
}
