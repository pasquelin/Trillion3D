import {
  STREAMING_RULES,
  type StreamingOptions,
} from '../../../../../sdk-core/src/contracts/streamingOptions.ts'
import { readSetting } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { roundUpToSignificantBits } from '../../../../../math/src/scalar/integers.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'

/**
 * THE READOUT'S SIZE FOLLOWS WHAT THE CUT ASKS OF IT. The readout's lists hold one rank a request —
 * a leaf the cut keeps and sees (`../request/request.ts`) — and one a cluster drawn
 * (`../readoutWords.ts`), `listCap` ranks each; the frame copies them whole into its readback. A
 * list sized for the worst cut copies it every frame, and a cut past a fixed size loses what it
 * asked past it: the size is the cut's, read after each readback, between two frames.
 *
 * It starts at the least the session's settings allow (`streamingMinRequests`) and follows the
 * most a readback asked of its lists (`listDemand`, `./listCap.ts`): over a quarter more than it
 * holds two readbacks running, it grows to that quarter over; under half of it thirty readbacks
 * running, it gives a fiftieth back at each. Never under the least nor over the most
 * (`streamingMaxRequests`), and the ranks the readout is made for are that size rounded up to two
 * significant bits, so it is made again a few times in a rise, not at each readback
 * (`../queueGrowth.ts`, `askListCap`).
 */

/** The least and the most ranks the settings allow the readout. */
export type RequestBounds = { readonly min: number; readonly max: number }

/** The bounds `options` name, read afresh each time they are asked — a session writes its
 *  settings in place, and the next readback follows —, each by its one resolver, its default when
 *  absent, the most never under the least. */
export const requestBounds = (options: StreamingOptions = {}): RequestBounds => ({
  get min() {
    return readSetting(STREAMING_RULES, options, 'streamingMinRequests')
  },
  get max() {
    return Math.max(this.min, readSetting(STREAMING_RULES, options, 'streamingMaxRequests'))
  },
})

/** Readbacks over what the size holds before it grows, and under half of it before it shrinks. */
const OVER_READBACKS = 2,
  UNDER_READBACKS = 30
/** The room kept over what the cut asks, and the part of the size given back at each readback of a
 *  fall. */
const HEADROOM = 1.25,
  FALL = 0.98

/** The size of a readout held within `bounds`, the least at first: `update` after each readback. */
export function createRequestSize(bounds: RequestBounds) {
  const held = { size: bounds.min, ranks: roundUpToSignificantBits(bounds.min, 2) }
  let over = 0,
    under = 0
  return {
    /** The bounds the size is held within. */
    bounds,
    /** The ranks the readout holds now, by the last update. */
    get ranks() {
      return held.ranks
    },
    /** Follows a readback that asked `asked` ranks of the lists; true when the ranks the readout
     *  holds moved. */
    update(asked: number) {
      const target = Math.floor(asked * HEADROOM)
      over = target > held.size ? over + 1 : 0
      under = asked < held.size * 0.5 ? under + 1 : 0
      if (over >= OVER_READBACKS) held.size = Math.max(held.size, target)
      else if (under >= UNDER_READBACKS) held.size *= FALL
      held.size = clamp(held.size, bounds.min, bounds.max)
      const ranks = roundUpToSignificantBits(Math.floor(held.size), 2),
        moved = ranks !== held.ranks
      held.ranks = ranks
      return moved
    },
  }
}
