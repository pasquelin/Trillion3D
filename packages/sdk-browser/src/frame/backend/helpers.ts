import type { PageRec } from '../../geometry/selection/types.ts'
import { copyRanks } from '../../geometry/cut/adoption/copyRanks.ts'

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
/** Remakes `drawn` and its packed ranks from `shown`'s: the one copy every adoption and the
 *  image make. The caller raises the flag (`markDrawnMirrored`). */
export function copyDrawnFromShown(run: Omit<DrawnMirror, 'drawnMirrorsShown'>) {
  copyRanks(run.drawn, run.shown)
  copyRanks(run.drawnPacked, run.shownPacked)
}
/** Remakes `drawn` from `shown` if it is no longer the copy of it; returns true if it did. */
export function mirrorDrawnFromShown(run: DrawnMirror) {
  if (run.drawnMirrorsShown) return false
  copyDrawnFromShown(run)
  markDrawnMirrored(run)
  return true
}
