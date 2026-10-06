import { createRefreshClock } from './refreshClock.ts'
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts'
import {
  createTargetCap,
  displayMoved,
  FALLBACK_REFRESH_MS,
  INTERVAL_PAUSE_MS,
  PERIOD,
} from './scaleTargets.ts'
import { createScaleMemory } from './scaleMemory.ts'
import { tickScale } from './scaleTick.ts'
import { createScaleWindow, forgetThreshold, holdFrame, sampleCost } from './scaleWindow.ts'

/**
 * THE FRAME LOOP'S RENDER SCALE (#831): one controller, from what the display and the GPU say.
 *
 * - The display's refresh `R`, measured on the rAF timestamps (`refreshClock.ts`, `display`): the
 *   shortest period they were seen to hold. Work only stretches an interval, so that period is the
 *   display's once intervals no work stretched were seen: the interactive loop's first frames are
 *   held, drawing nothing, until `SUPPORT` held intervals in a row agree, the group the clock reads
 *   a period from (`measuring`, `hold`; `PERIOD` at most) — whatever explicit renders came before
 *   them, which always draw. A page heavy from its first frame, whose
 *   every other refresh reads half the display's rate, is measured on frames it did not draw.
 * - Each drawn image's GPU span, as the timer gives it, brought to the current scale by the area
 *   it covers — `t · (s / sᵢ)²`, the cost model of a render that scales with its pixel count. Without GPU times
 *   (no timer, or none of late: `HISTORY` images), an image's cost is its area `s²`, the same model.
 * - Each presented interval: a moving image shown two refreshes or more missed the refresh.
 *
 * A frame meets the refresh while its GPU cost is at most `τ = R − N`, `N` the share of the frame
 * the GPU timer does not see (compositing, the CPU, presentation): `τ` is measured, never assumed.
 * The controller knows it between two costs — `lo`, the largest the frames met the refresh at over
 * a second, at most one of them missing; `hi`, the smallest they missed it at, two or more of them
 * (at most `R` with GPU times: a frame costing a whole refresh on the GPU alone cannot meet it) —
 * and tries a tenth below `hi`, a headroom that keeps the target off the edge of misses, while `lo` is further, then their
 * midpoint until the move it asks is within the noise, and holds `lo`. A miss is judged on the GPU
 * times that arrive after it, its image's among them. A miss at a cost already met is not the GPU's
 * (the CPU, a hitch): it moves nothing, so a page that turns CPU-bound keeps its scale. Not
 * covered: a page CPU-bound from its first frame (nothing met, the misses lower `hi` to the
 * floor).
 *
 * The scale fits the second costliest image since its last move to the target — one image a
 * second may miss, a lone spike moves nothing — by the exact area ratio, `s · √(τ / c₂)`, clamped
 * to the bounds and the memory cap; a move waits `PERIOD` frames after the last, so one move's effect is seen before the next, and
 * is taken past the controller's threshold, a rise only past the noise too: half the measured
 * relative spread of the costs (a scale moves as the root of a cost). At the floor, a frame that
 * cannot meet the refresh keeps the floor: no slower budget raises the scale (#831).
 *
 * At rest: after a still image the scale only lowers (#1343), so a still average closes at one
 * size and the frame is held, encoding nothing (`hold.ts`).
 *
 * One per session. `floor`: the minimum of a page that names none.
 *
 * Its members: `drawn`, the scale of the last image drawn (1 before any); `steered`, whether that
 * image was drawn at the controller's scale, which its cost then measures; `still`, whether it was
 * a still one; `refreshMs`, the refresh interval the clock measured (null until it found one);
 * `measuring`, whether the interactive loop holds the display frame that began, drawing nothing, to
 * measure the refresh on it (`hold`): its first frames, until `SUPPORT` held intervals in a row
 * agree — four frames at the least —, `PERIOD` at most; `held`, whether the display frame that
 * began was held, the loop then asks the next at once; `hold`, the loop held it; `frameIntervalMs`,
 * the interval from the previous display frame `tick` read to the last (null before two or after a
 * pause); `set`, another scale: the controller restarts at the bounds' maximum, knowing nothing;
 * `wanted`, the scale an image is drawn at, the controller's or the fixed one; `allocated`,
 * `capMemory`, `uncapMemory` and `memoryCapped`, the render targets' scale and memory cap
 * (`scaleMemory.ts`); `drew(scale, steered, still)`, an image was drawn; `tick(now, timed)`, a
 * frame of the display began at `now`, ms, its rAF timestamp, `timed`: the device has a GPU timer
 * (`tickScale`); `observe(gpuMs, scale, steered)`, the GPU time of an image drawn at `scale`, a few
 * frames late: a cost of the window, brought to the current scale by its area, where the image was
 * drawn at the controller's scale.
 */
export function createScaleControl(option: RenderScale | undefined, floor?: number) {
  const display = { width: 0, height: 0, ratio: 0 }
  displayMoved(display)
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS),
    w = createScaleWindow(renderScaleBounds(option, floor)),
    targets = createTargetCap(w.bounds.max),
    memory = createScaleMemory(w, targets),
    parts = { w, refresh, display, targets }
  const control = {
    get bounds() {
      return w.bounds
    },
    drawn: 1,
    steered: false,
    still: false,
    get refreshMs() {
      return refresh.settled ? refresh.display : null
    },
    get measuring() {
      return w.bounds.auto && !w.measured && w.held < PERIOD
    },
    get held() {
      return w.holding
    },
    hold: () => holdFrame(w),
    get frameIntervalMs() {
      const gap = refresh.gap
      return gap > 0 && gap < INTERVAL_PAUSE_MS ? gap : null
    },
    set(next: RenderScale | undefined) {
      w.bounds = renderScaleBounds(next, floor)
      targets.reset(w.bounds.max)
      w.s = w.max = w.bounds.max
      forgetThreshold(w, refresh.display)
    },
    wanted: () => (w.bounds.auto ? w.s : w.bounds.max),
    allocated: memory.allocated,
    capMemory: memory.cap,
    uncapMemory: memory.uncap,
    get memoryCapped() {
      return targets.capped
    },
    drew(scale: number, steered: boolean, still = false) {
      control.drawn = scale
      control.steered = steered
      control.still = still
      w.fresh = true
      w.images++
    },
    tick: (now: number, timed = false) => tickScale(parts, control, now, timed),
    observe(gpuMs: number | null, scale: unknown, steered = true) {
      if (gpuMs === null) return
      w.timedAt = w.images
      if (steered && w.timed && w.bounds.auto && typeof scale === 'number' && scale > 0)
        sampleCost(w, gpuMs * (w.s / scale) ** 2)
    },
  }
  return control
}

export type ScaleControl = ReturnType<typeof createScaleControl>
