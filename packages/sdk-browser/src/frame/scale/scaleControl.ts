import { createFrameCap, frameTimeBudget, resetFrameCap, skipsDisplayFrame } from '../cadence.ts'
import { createRefreshClock } from '../refreshClock.ts'
import { renderScaleBounds, type RenderScale, type RenderScaleBounds } from './renderScaleOption.ts'
import { createTargetCap, displayMoved, FALLBACK_REFRESH_MS, PERIOD } from './scaleTargets.ts'
import { createScaleMemory } from './scaleMemory.ts'
import { tickScale } from './scaleTick.ts'
import { createScaleWindow, forgetHistory, holdFrame } from './scaleWindow.ts'
import { recordFrame, refreshFraction } from './dynamicResolution.ts'

/**
 * THE FRAME LOOP'S RENDER SCALE: the dynamic resolution (`dynamicResolution.ts`), one controller
 * per session.
 *
 * - The display's refresh, the vsync rate, measured on the rAF timestamps (`../refreshClock.ts`,
 *   `display`): the interactive loop's first `PERIOD` display frames are held, drawing nothing,
 *   so a page heavy from its first frame is measured on intervals no work stretched
 *   (`measuring`, `hold`).
 * - The frame cap on vsync (`../cadence.ts`, `skips`), whose frame interval is the frame time
 *   budget.
 * - Each drawn image's GPU busy time, as the timer gives it, with the scale it was drawn at: one
 *   frame of the history, then the fraction refreshed (`observe`).
 *   Without GPU times the dynamic resolution records nothing and the image is drawn at the bounds'
 *   maximum (`scaleTick.ts`).
 *
 * Its members: `drawn`, the scale of the last image drawn (1 before any); `steered`, whether that
 * image was drawn at the controller's scale, which its cost then measures; `refreshMs`, the
 * refresh interval the clock measured (null until it found one); `measuring`, whether the
 * interactive loop holds the display frame that began, drawing nothing (`hold`); `held`, whether
 * the display frame that began was held, the loop then asks the next at once; `frameIntervalMs`, the interval
 * from the previous display frame `tick` read to the last (null before two); `set`, another scale:
 * the history forgotten; `fit(width, height)`, the view's drawing-buffer size, which the bounds
 * follow (`renderScaleBounds`); `maxFrameRate`, the page's frame cap (`../cadence.ts`); `wanted`, the scale an
 * image is drawn at, the fraction under the targets' upper bound, or the fixed one; `allocated`,
 * `capMemory`, `uncapMemory`, `memoryCapped`, `memoryRefused` and `liftMemoryCap`, the render
 * targets' scale, their memory cap and the clock its refusals are asked again by
 * (`scaleMemory.ts`); `drew(scale, steered)`, an image was drawn; `tick(now, timed)`, a frame of
 * the display began at `now`, ms, its rAF timestamp, `timed`: the device has a GPU timer
 * (`tickScale`); `observe(gpuMs, scale, steered)`, the GPU busy time of an image drawn at `scale`,
 * a few frames late, null where the timer read none.
 */
export function createScaleControl(option: RenderScale | undefined, maxFrameRate?: number) {
  const display = { width: 0, height: 0, ratio: 0 }
  displayMoved(display)
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS),
    w = createScaleWindow(renderScaleBounds(option, 0)),
    targets = createTargetCap(w.bounds.max),
    memory = createScaleMemory(w, targets),
    cap = createFrameCap(maxFrameRate),
    parts = { w, refresh, display, memory, cap }
  let asked = option,
    pixels = 0
  /** Other bounds: the targets at their maximum, uncapped, the history forgotten. */
  const rebound = (next: RenderScaleBounds) => {
    w.bounds = next
    targets.reset(next.max)
    w.max = next.max
    forgetHistory(w)
  }
  const control = {
    get bounds() {
      return w.bounds
    },
    drawn: 1,
    steered: false,
    get refreshMs() {
      return refresh.settled ? refresh.display : null
    },
    get measuring() {
      return w.bounds.auto && w.held < PERIOD
    },
    get held() {
      return w.holding
    },
    hold: () => holdFrame(w),
    get frameIntervalMs() {
      const gap = refresh.gap
      return gap > 0 ? gap : null
    },
    set(next: RenderScale | undefined) {
      asked = next
      rebound(renderScaleBounds(asked, pixels))
    },
    /** The view is `width` × `height` drawing-buffer pixels: the default fraction of it
     *  bounds the scale (`displayResolutionFraction`), read before the frame's targets are sized. */
    fit(width: number, height: number) {
      if (width * height === pixels) return
      pixels = width * height
      const next = renderScaleBounds(asked, pixels),
        { bounds } = w
      if (next.auto !== bounds.auto || next.min !== bounds.min || next.max !== bounds.max)
        rebound(next)
    },
    /** The page's frame cap, frames a second, infinite for none (`WorldOptions.maxFrameRate`). */
    get maxFrameRate() {
      return cap.maxFrameRate
    },
    /** Another frame cap: another frame time budget, the history forgotten. */
    set maxFrameRate(rate: number) {
      cap.maxFrameRate = rate
      resetFrameCap(cap, refresh.display)
      forgetHistory(w)
    },
    wanted: () => (w.bounds.auto ? Math.min(w.s, w.max) : w.bounds.max),
    allocated: memory.allocated,
    capMemory: memory.cap,
    uncapMemory: memory.uncap,
    memoryRefused: memory.refused,
    liftMemoryCap: memory.lift,
    get memoryCapped() {
      return targets.capped
    },
    drew(scale: number, steered: boolean) {
      control.drawn = scale
      control.steered = steered
      w.images++
    },
    tick: (now: number, timed = false) => tickScale(parts, now, timed),
    /** Whether the interactive loop leaves out the display frame that begins at `now`, ms, its rAF
     *  timestamp, under the frame cap: it draws nothing and counts no frame. */
    skips: (now: number) => skipsDisplayFrame(cap, refresh, now),
    observe(gpuMs: number | null, scale: number, steered = true) {
      if (gpuMs === null) return
      w.timedAt = w.images
      if (!steered || !w.bounds.auto || !w.timed || !(scale > 0)) return
      recordFrame(w.dynamic, gpuMs, scale)
      w.dynamic.budgetMs = frameTimeBudget(cap, refresh.display)
      refreshFraction(w.dynamic, w)
    },
  }
  return control
}

export type ScaleControl = ReturnType<typeof createScaleControl>
