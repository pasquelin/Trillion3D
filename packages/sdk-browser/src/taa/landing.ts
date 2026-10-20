import type { TaaFrameState } from './frameState.ts'

/** The history describes no image the view can still show — a view cut, new targets, the pass
 *  switched: dropped, and the jitter back to phase zero, so the new history starts on the
 *  sequence's first, best spread samples. */
export function dropTaaHistory(frame: TaaFrameState | undefined) {
  if (!frame) return
  frame.hasHistory = false
  frame.sample = 0
}
