import { resetFrameCap, type createFrameCap } from '../cadence.ts'
import type { createRefreshClock } from '../refreshClock.ts'
import { renderScaleBounds, type RenderScale, type RenderScaleBounds } from './renderScaleOption.ts'
import type { createTargetCap } from './scaleTargets.ts'
import { forgetHistory, type ScaleWindow } from './scaleWindow.ts'

/** What the controller's bounds and budget follow (`scaleControl.ts`): the scale the page asked
 *  (`set`), the drawing-buffer size of the view (`fit`) and the page's frame cap (`capFrames`).
 *  Each one that moves them puts the targets at their new maximum, uncapped, and the history
 *  forgotten. */
export function createScaleFollow(
  w: ScaleWindow,
  targets: ReturnType<typeof createTargetCap>,
  cap: ReturnType<typeof createFrameCap>,
  refresh: ReturnType<typeof createRefreshClock>,
  option: RenderScale | undefined,
) {
  let asked = option,
    pixels = 0
  const rebound = (next: RenderScaleBounds) => {
    w.bounds = next
    targets.reset(next.max)
    w.max = next.max
    forgetHistory(w)
  }
  return {
    /** Another scale asked: the bounds it gives. */
    set(next: RenderScale | undefined) {
      asked = next
      rebound(renderScaleBounds(asked, pixels))
    },
    /** The view is `width` × `height` drawing-buffer pixels: the default fraction of it bounds the
     *  scale (`displayResolutionFraction`), read before the frame's targets are sized. */
    fit(width: number, height: number) {
      if (width * height === pixels) return
      pixels = width * height
      const next = renderScaleBounds(asked, pixels),
        { bounds } = w
      if (next.auto !== bounds.auto || next.min !== bounds.min || next.max !== bounds.max)
        rebound(next)
    },
    /** Another frame cap, frames a second: another frame time budget. */
    capFrames(rate: number) {
      cap.maxFrameRate = rate
      resetFrameCap(cap, refresh.display)
      forgetHistory(w)
    },
  }
}
