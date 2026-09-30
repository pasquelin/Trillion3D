import { GRID_TOLERANCE } from './refreshClock.ts';
import { HEADROOM, PERIOD, rescale, type ScaleController } from './scaleController.ts';

/** Intervals in a row at the period before a probe, and the frames a probe lasts: the frames in
 *  flight, then the intervals the refresh clock needs to find a shorter period. */
const STEADY = 8,
  PROBE_FRAMES = 8;
/** A period below this share of the probed one is the faster display found. */
const FOUND = 0.75;
/** A cadence this fast already meets the rate the engine aims at (120 fps): a faster display is
 *  not looked for, so a device that holds 120 Hz never pays a probe's drop. */
const AIM_MS = 1000 / 120;

/**
 * A steady cadence is a display's refresh or a device that misses every other one (#1343): frames
 * every two refreshes of a 120 Hz display land on a 60 Hz grid, and the refresh clock reads 60 Hz.
 * The probe tells them apart once per period: after `STEADY` moving frames at it, the controller
 * at rest (`PERIOD` samples without a step), the scale drops for `PROBE_FRAMES` to one whose frame
 * fits half the period; if the clock then finds the shorter period, the display is faster and the
 * scale stays; if not, it goes back. With GPU times, a frame
 * already under half the period is limited elsewhere (the CPU, or the display itself): no probe.
 * Its cost where the display sets the cadence: one drop of `PROBE_FRAMES` moving frames per
 * display, slower than 120 Hz only (`AIM_MS`), the scale back as before; never a repeat.
 */
export function createCadenceProbe() {
  let steady = 0,
    /** The period last probed, where the display's own cadence was found. */
    tried = Number.NaN,
    from = 0,
    left = 0;
  return {
    /** Whether a probe is running: the controller takes no step meanwhile. */
    get active() {
      return left > 0;
    },
    /** Another display or controller: a running probe ends — `c`'s scale back where it began,
     *  given the controller it lowered —, and its periods are probed again. */
    reset(c?: ScaleController) {
      if (c && left > 0) rescale(c, from);
      tried = Number.NaN;
      steady = left = 0;
    },
    /**
     * A display frame began, `gap` ms after the last, the clock at `period`. `gpuMs`: the last
     * GPU time of an image at the controller's scale, null without GPU times (then the frame is
     * taken to cost the whole period). `moving`: the last image moved, so its scale may change.
     */
    tick(c: ScaleController, gap: number, period: number, gpuMs: number | null, moving: boolean) {
      if (left > 0) {
        if (period < FOUND * tried) {
          left = 0;
          rescale(c, c.s, true);
        } else if (--left === 0) rescale(c, from);
        return;
      }
      steady = Math.abs(gap - period) <= GRID_TOLERANCE * period ? steady + 1 : 0;
      if (
        steady < STEADY ||
        !moving ||
        c.since < PERIOD ||
        period <= (1 + GRID_TOLERANCE) * AIM_MS ||
        Math.abs(tried - period) <= GRID_TOLERANCE * period
      )
        return;
      tried = period;
      const half = (HEADROOM * period) / 2,
        cost = gpuMs ?? period;
      if (cost < half) return;
      const to = Math.max(c.min, c.s * Math.sqrt(half / cost));
      if (to >= c.s) return;
      from = c.s;
      rescale(c, to);
      left = PROBE_FRAMES;
    },
  };
}
