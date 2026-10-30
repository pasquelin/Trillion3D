import type { createTargetCap } from './scaleTargets.ts'
import type { ScaleWindow } from './scaleWindow.ts'
import { deviceRefusal, retryAt, type Refusal } from '../../gpu/core/refusal.ts'

/** The controller's share of the render targets' memory cap (`createTargetCap`), and the clock its
 *  refusals are asked again by: the view size refused last, and its refusal record
 *  (`../../gpu/core/refusal.ts`) — a budget whose room no measure predicts, the pools budgets of their
 *  own moved by each funding, is waited for as the device is. */
export function createScaleMemory(w: ScaleWindow, targets: ReturnType<typeof createTargetCap>) {
  // No refusal yet: a cap set otherwise is never lifted by the clock.
  let refusedView = '',
    refusal: Refusal | undefined
  const memory = {
    /** The scale the render targets of a `view` size are made at. */
    allocated: (view = '') => targets.allocated(w.bounds.max, view),
    /** The GPU budget refused the targets of the `view` size: they are made one eighth below
     *  (`createTargetCap`), the upper bound the fraction is drawn under, so no frame asks targets
     *  larger than those made. False at the bounds' minimum. */
    cap(view = '') {
      const below = targets.lower(w.bounds.min, view)
      if (Number.isNaN(below)) return false
      w.max = below
      return true
    },
    /** The room the cap stood for came back: the scale may grow to the bounds' maximum. */
    uncap() {
      targets.lift()
      w.max = w.bounds.max
    },
    /** Targets of the view size `size` refused at `now` (`refusalNow`): the time they may be asked again at, and
     *  the cap lifted at (`lift`) — later after each refusal at this view size. */
    refused(size: string, now: number) {
      refusal = deviceRefusal(now, size === refusedView ? refusal : undefined)
      refusedView = size
      return retryAt(refusal)
    },
    /** At `now` (`refusalNow`), the wait after the last refusal is over: the cap lifts, the targets are asked
     *  at the controller's scale again. */
    lift(now: number) {
      if (targets.capped && refusal && now >= retryAt(refusal)) memory.uncap()
    },
  }
  return memory
}
