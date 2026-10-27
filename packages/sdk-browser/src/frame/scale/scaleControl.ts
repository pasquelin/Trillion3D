import { createFrameCap, skipsDisplayFrame } from '../cadence.ts'
import { createRefreshClock } from '../refreshClock.ts'
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts'
import { createTargetCap, currentDisplay, FALLBACK_REFRESH_MS, PERIOD } from './scaleTargets.ts'
import { createScaleMemory } from './scaleMemory.ts'
import { createScaleFollow } from './scaleFollow.ts'
import { observeFrame, tickScale, type ScaleParts } from './scaleTick.ts'
import { createScaleWindow, edgeOf, holdFrame, vsmOf } from './scaleWindow.ts'
import { NO_TIMING } from './dynamicResolution.ts'

/** `observe` over the controller's `parts`: the GPU time of an image, and the times of its visibility
 *  passes and its shadow raster's where there are some to fit. */
const observerOf =
  (parts: ScaleParts) =>
  (gpuMs: number | null, scale: number, steered = true, edgeMs = NO_TIMING, vsmMs = NO_TIMING) =>
    observeFrame(parts, gpuMs, scale, steered, edgeMs, vsmMs)

/**
 * THE FRAME LOOP'S RENDER SCALE: the dynamic resolution (`dynamicResolution.ts`), one controller
 * per session.
 *
 * - The display's refresh, the vsync rate, measured on the rAF timestamps (`../refreshClock.ts`,
 *   `display`): the interactive loop's first `PERIOD` display frames are held, drawing nothing,
 *   so a page heavy from its first frame is measured on intervals no work stretched
 *   (`measuring`, `hold`).
 * - The frame cap on vsync (`../cadence.ts`, `skips(now)`: whether the loop leaves out the display
 *   frame that began at `now` — it draws nothing and counts no frame), whose frame interval is the
 *   frame time budget.
 * - Each drawn image's GPU busy time, as the timer gives it, with the scale it was drawn at: one
 *   frame of the history, then the fraction refreshed (`observe`).
 *   Without GPU times the dynamic resolution records nothing and the image is drawn at the bounds'
 *   maximum (`scaleTick.ts`).
 * - The cut's edge scale, one more budget of the same heuristic: a fraction of its screen error
 *   (`edge`), fitted to the GPU time of the passes that build the visibility buffer
 *   (`observe`) while the host gives it a budget. It is forgotten, and back at 1, where the render
 *   scale's history is.
 *
 * - The shadow raster's compute budget, a third of the same heuristic: a fraction (`vsm`), fitted to the
 *   GPU time of the shadow raster's passes (`observe`) while the shadows give it a budget
 *   (`shadowDynamicResolutionTimeBudgetMs`); the shadows throttle their maps by what it gives up. It is
 *   forgotten, and back at 1, where the render scale's history is.
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
 * (`tickScale`); `observe(gpuMs, scale, steered, edgeMs, vsmMs)`, the GPU busy time of an image drawn at
 * `scale`, a few frames late, null where the timer read none, the time of its visibility
 * passes and the time of its shadow raster's (`NO_TIMING` where there is none to fit); `edge`, the cut's
 * edge scale (`edgeOf`); `vsm`, the shadow raster's (`vsmOf`);
 * `rules`, the heuristic's settings, written in place by the frame; `noteCpu(ms)`, the CPU time
 * of the engine's image just drawn.
 */
export function createScaleControl(option: RenderScale | undefined, maxFrameRate?: number) {
  const display = currentDisplay(),
    refresh = createRefreshClock(FALLBACK_REFRESH_MS),
    w = createScaleWindow(renderScaleBounds(option, 0)),
    targets = createTargetCap(w.bounds.max),
    memory = createScaleMemory(w, targets),
    cap = createFrameCap(maxFrameRate),
    follow = createScaleFollow(w, targets, cap, refresh, option),
    parts = { w, refresh, display, memory, cap }
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
      return refresh.gap > 0 ? refresh.gap : null
    },
    set: follow.set,
    fit: follow.fit,
    get maxFrameRate() {
      return cap.maxFrameRate
    },
    set maxFrameRate(rate: number) {
      follow.capFrames(rate)
    },
    wanted: () => (w.bounds.auto ? Math.min(w.s, w.max) : w.bounds.max),
    edge: edgeOf(w),
    vsm: vsmOf(w),
    rules: w.rules,
    noteCpu: (ms: number) => void (w.cpuMs = ms),
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
    skips: (now: number) => skipsDisplayFrame(cap, refresh, now),
    observe: observerOf(parts),
  }
  return control
}

export type ScaleControl = ReturnType<typeof createScaleControl>
