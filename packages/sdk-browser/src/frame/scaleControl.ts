import { createRefreshClock, createScaleController, nextScale } from './scaleController.ts';
import { renderScaleBounds, type RenderScale } from './renderScaleOption.ts';

/** The budget before the display's refresh is measured: 60 Hz. */
const FALLBACK_REFRESH_MS = 1000 / 60;

/**
 * A session's render scale: the bounds the page asked (`renderScaleBounds`), the controller that
 * picks the scale within them from the whole-frame GPU time when they are `'auto'`, the display's
 * measured refresh that is its budget, and the scale of the last image drawn — what
 * `world.renderScale` reads back. `floor`: the minimum of a page that names none
 * (`renderScaleBounds`).
 */
export function createScaleControl(option: RenderScale | undefined, floor?: number) {
  const refresh = createRefreshClock(FALLBACK_REFRESH_MS);
  let bounds = renderScaleBounds(option, floor),
    controller = createScaleController(bounds.min, bounds.max, refresh.interval);
  const control = {
    get bounds() {
      return bounds;
    },
    /** The scale of the last image drawn: 1 before any. */
    drawn: 1,
    /** Whether the last image was drawn at the controller's scale: a moving, accumulated image. */
    steered: false,
    /** Asks another scale: the controller restarts at the bounds' maximum. */
    set(next: RenderScale | undefined) {
      bounds = renderScaleBounds(next, floor);
      controller = createScaleController(bounds.min, bounds.max, refresh.interval);
    },
    /** The scale a moving image is drawn at: the controller's, or the fixed one. */
    wanted: () => (bounds.auto ? controller.s : bounds.max),
    /** The scale this image is drawn at: a quiet one at the bounds' maximum — which the held image
     *  then is —, a moving one at `wanted`'s. */
    imageScale(quiet: boolean) {
      return quiet ? bounds.max : control.wanted();
    },
    /** A frame of the display began at `now`, ms: the budget follows its measured refresh. */
    tick(now: number) {
      refresh.tick(now);
      controller.budget = refresh.interval;
    },
    /**
     * The whole-frame GPU time of an image drawn at `scale`, as it arrives, a few frames late.
     * Only a moving image drawn at the controller's current scale (`steered`) steps it: one drawn
     * before the last change, a still one at the maximum, or one without accumulation measures
     * another cost.
     */
    observe(gpuMs: number | null, scale: unknown, steered = true) {
      if (!bounds.auto || !steered || gpuMs === null || !(gpuMs > 0) || scale !== controller.s)
        return;
      nextScale(controller, gpuMs);
    },
  };
  return control;
}

export type ScaleControl = ReturnType<typeof createScaleControl>;
