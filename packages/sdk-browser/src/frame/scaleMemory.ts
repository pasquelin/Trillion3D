import type { createTargetCap } from './scaleTargets.ts'
import { restartWindow, type ScaleWindow } from './scaleWindow.ts'

/** Frames a refused size waits before it is asked again, then twice as many after each refusal,
 *  up to `RETRY_MAX` times that: a budget whose room no measure predicts — the pools are budgets of
 *  their own, moved by each funding — is asked again rarely, never every frame, never never. */
const RETRY_FRAMES = 300,
  RETRY_MAX = 64

/** The controller's share of the render targets' memory cap (`createTargetCap`), and the clock its
 *  refusals are asked again by: the view size refused last, the wait it set, the frame it ends. */
export function createScaleMemory(w: ScaleWindow, targets: ReturnType<typeof createTargetCap>) {
  // No refusal yet: a cap set otherwise is never lifted by the clock.
  const refusal = { view: '', wait: 0, at: Infinity }
  const memory = {
    /** The scale the render targets of a `view` size are made at. */
    allocated: (view = '') => targets.allocated(w.bounds.max, view),
    /** The GPU budget refused the targets of the `view` size: they are made one eighth below
     *  (`createTargetCap`), and the scale held there too — above it, an image the targets draw
     *  smaller is not one it measures (`drawFrameAt`). False at the bounds' minimum. */
    cap(view = '') {
      const below = targets.lower(w.bounds.min, view)
      if (Number.isNaN(below)) return false
      w.max = below
      if (w.s > below) {
        w.s = below
        restartWindow(w)
      }
      return true
    },
    /** The room the cap stood for came back: the scale may grow to the bounds' maximum. */
    uncap() {
      targets.lift()
      w.max = w.bounds.max
    },
    /** Targets of the `view` size refused at `frame`: the frame they may be asked again at, and
     *  the cap lifted at (`lift`) — later after each refusal at this view size. */
    refused(view: string, frame: number) {
      refusal.wait =
        refusal.view === view ? Math.min(refusal.wait * 2, RETRY_FRAMES * RETRY_MAX) : RETRY_FRAMES
      refusal.view = view
      refusal.at = frame + refusal.wait
      return refusal.at
    },
    /** At `frame`, the wait after the last refusal is over: the cap lifts, the targets are asked
     *  at the controller's scale again. */
    lift(frame: number) {
      if (targets.capped && frame >= refusal.at) memory.uncap()
    },
  }
  return memory
}
