// How fast a track's sampled value moves: what bounds how far a pose kept since some clip time
// lags the true one (`poseHold.ts`). Read once from the keys, for each interpolation `sample`
// knows (`trackSegment.ts`).
import { trackWidth, type Clip, type Track } from './clip.ts'
import { LEAPS, segmentSpeed } from './trackSegment.ts'

/**
 * How a track's sampled value `c(t)` moves, `c` read as a point of ℝⁿ — a rotation as the unit
 * quaternion `sample` writes, on the sphere of ℝ⁴, its sign kept continuous. Between keys `i` and
 * `i + 1`, `|c'| ≤ speeds[i]`; before the first key and after the last, `c` stands still. A step
 * that changes the value, or two keys at one time, makes the value itself leap at a key.
 */
export type TrackMotion = {
  /** The most `|c'|` on each segment, from key `i` to `i + 1`, per second. */
  speeds: Float64Array
  /** The times the value leaps at, in order. */
  leapsAt: Float64Array
}

const keyTimes = new WeakMap<Clip, Float64Array>()
/** Every time a track of `clip` has a key at, and its end, in order, once: between two of them,
 *  every track of the clip moves on one segment and none leaps. */
export function clipKeys(clip: Clip) {
  let found = keyTimes.get(clip)
  if (!found) {
    const all = new Set<number>([clip.duration])
    for (const tr of clip.tracks) for (const t of tr.times) all.add(t)
    keyTimes.set(clip, (found = Float64Array.from(all).sort()))
  }
  return found
}

const motions = new WeakMap<Clip, TrackMotion[]>()
/** Each track's motion, read from its keys once a clip. */
export function clipMotion(clip: Clip) {
  let found = motions.get(clip)
  if (!found) motions.set(clip, (found = clip.tracks.map(motionOf)))
  return found
}

/** `tr`'s motion. */
function motionOf(tr: Track): TrackMotion {
  const { times } = tr,
    keys = times.length,
    width = trackWidth(tr),
    speeds = new Float64Array(Math.max(0, keys - 1)),
    leapsAt: number[] = []
  for (let i = 0; i + 1 < keys; i++) {
    const speed = segmentSpeed(tr, i, times[i + 1] - times[i], width)
    if (speed === LEAPS) leapsAt.push(times[i + 1])
    else speeds[i] = speed
  }
  return { speeds, leapsAt: Float64Array.from(leapsAt) }
}
