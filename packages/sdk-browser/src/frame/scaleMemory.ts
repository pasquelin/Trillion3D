import type { createTargetCap } from './scaleTargets.ts'
import { restartWindow, type ScaleWindow } from './scaleWindow.ts'

/** The controller's share of the render targets' memory cap (`createTargetCap`). */
export function createScaleMemory(w: ScaleWindow, targets: ReturnType<typeof createTargetCap>) {
  return {
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
  }
}
