/** THE SHADOW MAPS' OVERFLOWS, AS THE HOST SEES THEM: what a frame could not hold, read back with the
 *  pool's status (`feedbackReadback.ts`) — the bits of `VSM_OVERFLOW_*`. Each kind is logged once, when it
 *  is first seen, and the time it was last seen is kept for the stats to report the kinds of the last
 *  10 seconds. */
import {
  VSM_OVERFLOW_KINDS,
  VSM_OVERFLOW_MAP_SLOTS,
  VSM_OVERFLOW_MARKING_JOB_QUEUE,
  VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS,
  VSM_OVERFLOW_PAGE_POOL,
  VSM_OVERFLOW_RECORDS,
  VSM_OVERFLOW_VISIBLE_INSTANCES,
} from './constants.ts'

/** Milliseconds an overflow stays reported after it was last seen. */
const REPORT_MS = 10_000

/** The log line of the overflow `flag`; `pagesShort` the page requests the pool did not serve. */
function overflowMessage(flag: number, pagesShort: number) {
  switch (flag) {
    case VSM_OVERFLOW_MARKING_JOB_QUEUE:
      return "[VSM] The non-cluster marking's job queue overflowed, which may slow the frame. It happens when many non-cluster meshes cover a large area of a shadow map."
    case VSM_OVERFLOW_ONE_PASS_MAX_LIGHTS:
      return '[VSM] More shadowed local lights than the one-pass projection keeps in a pixel. If shadow artifacts show, put fewer local lights on a pixel or raise shadowOnePassProjectionMaxLightsPerPixel.'
    case VSM_OVERFLOW_PAGE_POOL:
      return `[VSM] The page pool overflowed (${pagesShort} page requests were not served): the shadow is missing where they fell. Raise the page pool or reduce the resolution bias.`
    case VSM_OVERFLOW_VISIBLE_INSTANCES:
      return "[VSM] The casters' list overflowed: the shadow is missing for the casters past its room."
    case VSM_OVERFLOW_MAP_SLOTS:
      return '[VSM] More shadow maps than the set has slots for: the farthest lights cast no shadow this frame while the slots grow.'
    case VSM_OVERFLOW_RECORDS:
      return "[VSM] The raster's records list overflowed: the shadow is missing for the page windows past its room. Raise shadowRasterIndirectionMultiplier."
    default:
      return '[VSM] Unknown overflow'
  }
}

/** The overflows a set of shadow maps saw: the kinds logged, the time each was last seen and the lines
 *  not yet said (`drain`). */
export class VsmOverflowLog {
  private logged = 0
  private readonly seen = new Float64Array(VSM_OVERFLOW_KINDS).fill(-Infinity)
  private readonly unsaid: string[] = []

  /** Records the kinds of `flags` seen at `now` (ms); `pagesShort` the page requests the pool did not
   *  serve in the frame the flags are of. */
  note(flags: number, now: number, pagesShort = 0) {
    if (flags === 0) return
    for (let kind = 0; kind < VSM_OVERFLOW_KINDS; kind++) {
      const flag = 1 << kind
      if ((flags & flag) === 0) continue
      this.seen[kind] = now
      if ((this.logged & flag) !== 0) continue
      this.logged |= flag
      this.unsaid.push(overflowMessage(flag, pagesShort))
    }
  }

  /** The pool serves every request again: its next overflow is logged anew. */
  poolServed() {
    this.logged &= ~VSM_OVERFLOW_PAGE_POOL
  }

  /** The kinds seen in the last 10 seconds before `now` (ms), as bits. */
  recent(now: number) {
    let flags = 0
    for (let kind = 0; kind < VSM_OVERFLOW_KINDS; kind++)
      if (now - this.seen[kind] < REPORT_MS) flags |= 1 << kind
    return flags
  }

  /** Hands the lines not yet said to `say`, once each. */
  drain(say: (line: string) => void) {
    for (const line of this.unsaid) say(line)
    this.unsaid.length = 0
  }
}
