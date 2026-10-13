import type { createTargetCap } from './scaleTargets.ts'
import { restartWindow, type ScaleWindow } from './scaleWindow.ts'
import { deviceRefusal, retryFrame, type Refusal } from '../gpu/core/refusal.ts'

/** The controller's share of the render targets' memory cap (`createTargetCap`), and the clock its
 *  refusals are asked again by: the view size refused last, and its refusal record
 *  (`../gpu/core/refusal.ts`) — a budget whose room no measure predicts, the pools budgets of their
 *  own moved by each funding, is waited for as the device is. */
export function createScaleMemory(w: ScaleWindow, targets: ReturnType<typeof createTargetCap>) {
  // No refusal yet: a cap set otherwise is never lifted by the clock.
  let refusedView = '',
    refusal: Refusal | undefined
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
    /** Targets of the view size `size` refused at `frame`: the frame they may be asked again at, and
     *  the cap lifted at (`lift`) — later after each refusal at this view size. */
    refused(size: string, frame: number) {
      refusal = deviceRefusal(frame, size === refusedView ? refusal : undefined)
      refusedView = size
      return retryFrame(refusal)
    },
    /** At `frame`, the wait after the last refusal is over: the cap lifts, the targets are asked
     *  at the controller's scale again. */
    lift(frame: number) {
      if (targets.capped && refusal && frame >= retryFrame(refusal)) memory.uncap()
    },
  }
  return memory
}
