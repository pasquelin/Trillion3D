import { createScaleController, nextScale, rescale } from './scaleController.ts';
import { createRefreshClock } from './refreshClock.ts';
import { createCadenceProbe } from './cadenceProbe.ts';
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts';

/** The budget before the display's refresh is measured. */
const FALLBACK_REFRESH_MS = 1000 / 60;
/** The targets are made on a ladder of eighths of the display, so a small step of the scale
 *  remakes nothing. */
const ALLOCATION_STEP = 8;
/** `scale` up to the next eighth of the display. */
const rung = (scale: number) => Math.ceil(scale * ALLOCATION_STEP - 1e-9) / ALLOCATION_STEP;
/** A frame interval under this many budgets met the display's cadence; a longer one missed it. */
const MET = 1.5;
/** What a frame that met the cadence reports, in budgets: under the dead band, so a long run of
 *  them lets the scale try a step up. */
const MET_COST = 0.7;
/** An interval this long is a pause (a hidden page), not a frame's cost; longer than the refresh
 *  clock's, since a device that draws at 5 fps still has to learn. */
const INTERVAL_PAUSE_MS = 500;
/** A period this many times the last one is a slower display: the controller's scale, chosen
 *  against the faster one's budget, grows as the budget did. */
const RISE = 1.5;

/** The display the page is on, read at each frame: another size or pixel ratio (a window moved
 *  to another screen) resets the refresh clock. */
function displayKey() {
  const screen = globalThis.screen;
  return screen ? `${screen.width}x${screen.height}@${globalThis.devicePixelRatio}` : '';
}

/**
 * The cost of the image drawn before a display frame, read from the frame interval `gap` where
 * the device has no GPU timestamps (#1343). An interval that met the cadence tells no headroom:
 * `MET_COST`. One that missed it cost more than a budget and at most itself: the midpoint.
 */
function intervalCost(gap: number, budget: number) {
  return gap < MET * budget ? MET_COST * budget : (budget + gap) / 2;
}

/**
 * A session's render scale: the bounds the page asked (`renderScaleBounds`), the controller that
 * picks the scale within them when they are `'auto'`, the display's measured refresh that is its
 * budget, and the scale of the last image drawn — what `world.renderScale` reads back. The
 * controller learns from the whole-frame GPU time (`observe`) or, on a device whose timer cannot
 * measure, from the frame interval (`tick`). `floor`: the minimum of a page that names none
 * (`renderScaleBounds`).
 */
export function createScaleControl(option: RenderScale | undefined, floor?: number) {
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS),
    probe = createCadenceProbe();
  let display = displayKey(),
    /** The last GPU time of an image at the controller's scale, null before one. */
    gpu: number | null = null;
  let bounds = renderScaleBounds(option, floor),
    controller = createScaleController(bounds.min, bounds.max, refresh.interval),
    /** An image was drawn since the last display frame. */
    fresh = false,
    /** The eighth of the display the targets are made at (`allocated`). */
    made = bounds.max;
  /** One step from an image drawn at `scale`: a `still` one may only lower the scale. */
  const step = (ms: number, scale: unknown, still: boolean) => {
    if (bounds.auto && ms > 0 && scale === controller.s && !probe.active)
      nextScale(controller, ms, !still);
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
      made = bounds.max;
      gpu = null;
      probe.reset();
    },
    /** The scale an image is drawn at: the controller's, or the fixed one. */
    wanted: () => (bounds.auto ? controller.s : bounds.max),
    /** The scale of an engine that does not reconstruct (WebGL2): a quiet image at the bounds'
     *  maximum — which the held image then is —, a moving one at `wanted`'s. */
    imageScale(quiet: boolean) {
      return quiet ? bounds.max : control.wanted();
    },
    /** The scale the render targets are made at: `wanted`'s, up to the next eighth. They grow at
     *  once, and shrink only once `wanted` is two eighths below them, so a scale that hovers at
     *  an eighth never remakes them back and forth. */
    allocated() {
      const next = Math.min(bounds.max, rung(control.wanted()));
      if (next > made || next <= made - 2 / ALLOCATION_STEP) made = next;
      return made;
    },
    /** An image was drawn at `scale`; `steered`, at the controller's; `still`, a still one. */
    drew(scale: number, steered: boolean, still = false) {
      control.drawn = scale;
      control.steered = steered;
      control.still = still;
      fresh = true;
    },
    /** A frame of the display began at `now`, ms, its rAF timestamp: the budget follows its
     *  measured refresh, a steady cadence is probed for a faster display, and, where the GPU timer
     *  cannot measure (`timed` false), the interval since the last frame is the cost of the image
     *  drawn in it — once the clock has a period, so a new display's first frames step nothing. */
    tick(now: number, timed = false) {
      const key = displayKey();
      if (key !== display) {
        display = key;
        refresh.reset();
        probe.reset(controller);
      }
      const before = refresh.interval,
        gap = refresh.tick(now);
      if (!(gap > 0)) return;
      const rise = refresh.interval / before;
      if (rise >= RISE)
        rescale(controller, Math.min(controller.max, controller.s * Math.sqrt(rise)));
      controller.budget = refresh.interval;
      if (!timed && fresh && control.steered && refresh.settled && gap < INTERVAL_PAUSE_MS)
        step(intervalCost(gap, controller.budget), control.drawn, control.still);
      if (bounds.auto && refresh.settled && (!timed || gpu !== null))
        probe.tick(controller, gap, refresh.interval, timed ? gpu : null, !control.still);
      fresh = false;
    },
    /**
     * The whole-frame GPU time of an image drawn at `scale`, as it arrives, a few frames late.
     * Only an image drawn at the controller's current scale (`steered`) steps it: one drawn
     * before the last change, or one without accumulation, measures another cost. `still`: that
     * image was a still one, whose cost only lowers the scale — not the last image's stillness,
     * which may have changed since.
     */
    observe(gpuMs: number | null, scale: unknown, steered = true, still = false) {
      if (!steered || gpuMs === null) return;
      if (scale === controller.s) gpu = gpuMs;
      step(gpuMs, scale, still);
    },
  };
  return control;
}

export type ScaleControl = ReturnType<typeof createScaleControl>;
