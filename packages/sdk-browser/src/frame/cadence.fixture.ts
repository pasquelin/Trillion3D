// A fixed-scale page on a generated display, for the frame cap's tests (`cadenceCap.test.ts`):
// when each image is shown.
import type { createScaleControl } from './scaleControl.ts'
import { HZ120 } from './scaleFit.fixture.ts'

/** Images the display queues at most: a frame is asked once one is free, as the browser's
 *  animation frames wait for the compositor (`FRAMES_IN_FLIGHT`). */
const QUEUED = 2
/** Images a GPU time arrives late. */
export const LAG = 2

type Control = ReturnType<typeof createScaleControl>
/** Where a run ends: the next refresh, and when the GPU is free. */
type At = { refresh: number; free: number }

/**
 * A fixed-scale page for `seconds` on a display refreshing every `period` ms, from `at`: at each
 * refresh `k` the loop draws unless its display frame is left out (`skips`) or the display still
 * queues `QUEUED` images; the image costs `gpu(k)` ms of GPU time,
 * the GPU runs the images one after the other, and each is shown at the first refresh after its
 * end. Returns when each image was shown.
 */
export function run(
  control: Control,
  seconds: number,
  gpu: (k: number) => number,
  at: At = { refresh: 0, free: 0 },
  period = HZ120,
) {
  const shown: number[] = [],
    late: number[] = [],
    end = at.refresh + Math.round((seconds * 1000) / period)
  for (let k = at.refresh; k < end; k++) {
    const t = k * period
    const queued = shown.filter((when) => when > t + 1e-9).length
    if (control.skips(t) || queued >= QUEUED) continue
    control.tick(t, true)
    const cost = gpu(k)
    at.free = Math.max(at.free, t) + cost
    shown.push(Math.ceil(at.free / period - 1e-9) * period)
    control.drew(1, false)
    late.push(cost)
    if (late.length > LAG) control.observe(late.shift()!, 1, false)
  }
  at.refresh = end
  return { shown, at }
}

/** The intervals between the images shown, in refreshes of `period`. */
export const intervals = (shown: number[], period = HZ120) =>
  shown.slice(1).map((when, i) => Math.round((when - shown[i]) / period))
