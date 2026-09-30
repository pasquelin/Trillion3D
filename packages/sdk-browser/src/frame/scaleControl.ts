import { createRefreshClock, createScaleController, nextScale } from './scaleController.ts';
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts';

/** The budget before the display's refresh is measured, and the longest it can be: 60 Hz. */
const FALLBACK_REFRESH_MS = 1000 / 60;
/** The targets are made on a ladder of eighths of the display, so a small step of the scale
 *  remakes nothing. */
const ALLOCATION_STEP = 8;
/** A frame interval under this many budgets met the display's cadence; a longer one missed it. */
const MET = 1.5;
/** What a frame that met the cadence reports, in budgets: under the dead band, so a long run of
 *  them lets the scale try a step up. */
const MET_COST = 0.7;
/** An interval this long is a pause (a hidden page), not a frame's cost. */
const PAUSE_MS = 500;

/**
 * The cost of the image drawn before a display frame, read from the frame interval `gap` where
 * the device has no GPU timestamps (#1343). An interval that met the cadence tells no headroom:
 * `MET_COST`. One that missed it cost more than a budget and at most itself: the midpoint.
 */
export function intervalCost(gap: number, budget: number) {
  return gap < MET * budget ? MET_COST * budget : (budget + gap) / 2;
}

/**
 * A session's render scale: the bounds the page asked (`renderScaleBounds`), the controller that
 * picks the scale within them when they are `'auto'`, the display's measured refresh that is its
 * budget, and the scale of the last image drawn — what `world.renderScale` reads back. The
 * controller learns from the whole-frame GPU time (`observe`) or, on a device that never gave
 * one, from the frame interval (`tick`). `floor`: the minimum of a page that names none
 * (`renderScaleBounds`).
 */
export function createScaleControl(option: RenderScale | undefined, floor?: number) {
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS);
  let bounds = renderScaleBounds(option, floor),
    controller = createScaleController(bounds.min, bounds.max, refresh.interval),
    /** A GPU time was measured: the frame interval no longer steps the controller. */
    timed = false,
    /** The scale of the image drawn since the last display frame, when it steps the controller. */
    pending = Number.NaN;
  /** One step from an image drawn at `scale`: a still one may only lower the scale. */
  const step = (ms: number, scale: unknown, steered: boolean) => {
    if (!bounds.auto || !steered || !(ms > 0) || scale !== controller.s) return;
    nextScale(controller, ms, !control.still);
  };
  const control = {
    get bounds() {
      return bounds;
    },
    /** The scale of the last image drawn: 1 before any. */
    drawn: 1,
    /** Whether the last image was drawn at the controller's scale, which its cost then steps. */
    steered: false,
    /** Whether the last image was a still one: its accumulation restarts at any other scale, so
     *  while images are still the controller only lowers the scale. */
    still: false,
    /** Asks another scale: the controller restarts at the bounds' maximum. */
    set(next: RenderScale | undefined) {
      bounds = renderScaleBounds(next, floor);
      controller = createScaleController(bounds.min, bounds.max, refresh.interval);
    },
    /** The scale an image is drawn at: the controller's, or the fixed one. */
    wanted: () => (bounds.auto ? controller.s : bounds.max),
    /** The scale of an engine that does not reconstruct (WebGL2): a quiet image at the bounds'
     *  maximum — which the held image then is —, a moving one at `wanted`'s. */
    imageScale(quiet: boolean) {
      return quiet ? bounds.max : control.wanted();
    },
    /** The scale the render targets are made at: `wanted`'s, up to the next eighth. */
    allocated() {
      const scale = control.wanted();
      return Math.min(bounds.max, Math.ceil(scale * ALLOCATION_STEP - 1e-9) / ALLOCATION_STEP);
    },
    /** An image was drawn at `scale`; `steered`, at the controller's; `still`, a still one. */
    drew(scale: number, steered: boolean, still = false) {
      control.drawn = scale;
      control.steered = steered;
      control.still = still;
      pending = steered ? scale : Number.NaN;
    },
    /** A frame of the display began at `now`, ms: the budget follows its measured refresh, and,
     *  without GPU times, the interval since the last is the cost of the image drawn in it. */
    tick(now: number) {
      const gap = refresh.tick(now);
      controller.budget = refresh.interval;
      if (!timed && gap < PAUSE_MS) step(intervalCost(gap, controller.budget), pending, true);
      pending = Number.NaN;
    },
    /**
     * The whole-frame GPU time of an image drawn at `scale`, as it arrives, a few frames late.
     * Only an image drawn at the controller's current scale (`steered`) steps it: one drawn
     * before the last change, or one without accumulation, measures another cost.
     */
    observe(gpuMs: number | null, scale: unknown, steered = true) {
      if (gpuMs !== null && gpuMs > 0) timed = true;
      step(gpuMs ?? 0, scale, steered);
    },
  };
  return control;
}

export type ScaleControl = ReturnType<typeof createScaleControl>;
