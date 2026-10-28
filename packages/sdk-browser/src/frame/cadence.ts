import { GRID_TOLERANCE } from './refreshClock.ts'
import { SECOND_MS } from './scale/scaleTargets.ts'

/**
 * THE FRAME CAP, `maxFrameRate`: the loop waits `1 / maxFrameRate` from the last frame before it
 * starts the next. Under the display's vsync a frame starts on a refresh, so the wait is the
 * fewest whole refreshes not under `1 / maxFrameRate`
 * (`floor`): the loop draws on every `floor`-th refresh, each image shown for the same time. No cap,
 * every refresh. Nothing else paces the loop: the GPU's cost is the dynamic resolution's alone
 * (`scale/dynamicResolution.ts`).
 *
 * The frame time budget the dynamic resolution fits to is the frame interval this target gives
 * (`frameTimeBudget`): an image that fits the interval is shown on time, one that does not is
 * shown a refresh late, so the interval is the whole budget a frame has.
 *
 * State in an object's fields, stored in place: a frame boxes no number.
 */
export function createFrameCap(maxFrameRate = Infinity) {
  return {
    /** The page's frame cap, frames a second (`WorldOptions.maxFrameRate`): none when infinite. */
    maxFrameRate,
    /** The fewest display frames a drawn frame spans under the cap (`capFloor`). */
    floor: 1,
    /** When the last display frame the loop drew began, ms (its rAF timestamp). */
    drawnAt: Number.NaN,
  }
}

export type FrameCap = ReturnType<typeof createFrameCap>

/** The fewest refreshes of `period` ms a drawn frame spans for at most `maxFrameRate` frames a
 *  second: a whole number of them, the fastest such rate at or under the cap, within the timer's
 *  tolerance (12 a second: 5 refreshes at 60 Hz, 10 at 120 Hz, 14 at 165 Hz). 1 without a cap. */
const capFloor = (maxFrameRate: number, period: number) =>
  maxFrameRate > 0 && Number.isFinite(maxFrameRate)
    ? Math.max(1, Math.ceil(SECOND_MS / maxFrameRate / period - GRID_TOLERANCE))
    : 1

/** The cap read again on a refresh of `period` ms. */
export function resetFrameCap(c: FrameCap, period: number) {
  c.floor = capFloor(c.maxFrameRate, period)
}

/** The frame time budget on a refresh of `period` ms: the interval the cap draws at — the refresh,
 *  or the refreshes the cap spans. */
export const frameTimeBudget = (c: FrameCap, period: number) => c.floor * period

/** Whether a frame `since` ms after the last drawn one is too soon for a cap of `floor` refreshes
 *  of `period` ms: under `floor − ½` of them — the half takes the timestamps' jitter. */
const tooSoon = (floor: number, period: number, since: number) =>
  floor > 1 && since < (floor - 0.5) * period

/** Whether a view capped at `maxFrameRate` leaves out the display frame that begins `since` ms after
 *  its last drawn one, the display refreshing every `period` ms (null until measured, none left
 *  out): the rule of the main view's cap (`skipsDisplayFrame`), for any view. */
export const capSkips = (maxFrameRate: number, period: number | null, since: number) =>
  period !== null && tooSoon(capFloor(maxFrameRate, period), period, since)

/** What the cap reads of the refresh clock (`refreshClock.ts`), its fields loaded in place. */
type Refresh = { readonly display: number; readonly settled: boolean }

/** Whether the display frame that begins at `now` is left out under the cap: too soon
 *  (`tooSoon`) after the last drawn, the display's refresh (`refresh`) known. */
export function skipsDisplayFrame(c: FrameCap, refresh: Refresh, now: number) {
  return refresh.settled && tooSoon(c.floor, refresh.display, now - c.drawnAt)
}
