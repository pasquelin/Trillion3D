import { arriveRank, rankBits, type MobilityState } from './mobilityState.ts'
import { MOBILITY_SHADOWLESS, MOBILITY_WORLD_SPACE } from '../mobilityBits.ts'

/** What the words are written from, by placement rank: how it casts (`castFlagsOf`), the square of
 *  the distance past which its object stops evaluating its offset (0 for never), and the reach of
 *  its deformation (0 for none). */
export interface RootWordSources {
  castFlags: (rank: number) => number
  disableSq?: (rank: number) => number
  deformReach?: (rank: number) => number
}

/**
 * Writes the words of the placements that need it — every placement once on a new layout, else the
 * ones `touch`ed since (they started or stopped moving, casting or casting far, were parked or
 * taken, turned static) — and hands each run of words that changed to `push`, as one span. A word
 * `touch`ed with nothing changed is not pushed. `castFlags` says how a placement casts:
 * `MOBILITY_SHADOWLESS` where it casts no shadow — `castShadow = false`, hidden or parked —, which
 * every caster pass skips, `MOBILITY_FAR_SHADOW` where it casts far shadows (`castFarShadow`), which
 * a sun's far-shadow test never leaves out, and the others of `castFlagsOf`. `disableSq` is written
 * beside the word, and `deformReach` the reach of the deformation; both are held as the
 * single-precision numbers the arrays store, so that a repeat compares equal and is not pushed again,
 * and a placement whose distance or reach changed is pushed too. A placement that arrives — new in
 * the layout, or casting after it cast nothing — and is often moving starts moving (`arriveRank`).
 */
export function writeRootWords(
  s: MobilityState,
  push: (first: number, count: number) => void,
  { castFlags, disableSq = () => 0, deformReach = () => 0 }: RootWordSources,
) {
  const placements = s.moving.length
  if (s.wholeWords) {
    s.wholeWords = false
    s.changed.clear()
    s.worldSpace = 0
    for (let rank = 0; rank < placements; rank++) {
      const cast = castFlags(rank)
      if (rank >= s.arrived) arriveRank(s, rank, cast)
      s.words[rank] = rankBits(s, rank, cast)
      s.disable[rank] = disableSq(rank)
      s.reach[rank] = deformReach(rank)
      if (s.words[rank] & MOBILITY_WORLD_SPACE) s.worldSpace++
    }
    s.arrived = placements
    if (placements) push(0, placements)
    return
  }
  if (!s.changed.count) return
  const { count, pairs } = s.changed.runs()
  let first = -1,
    last = -2
  for (let run = 0; run < count; run++) {
    for (let rank = pairs[2 * run]; rank <= pairs[2 * run + 1]; rank++) {
      const cast = castFlags(rank),
        was = s.words[rank]
      if (was & MOBILITY_SHADOWLESS && !(cast & MOBILITY_SHADOWLESS)) arriveRank(s, rank, cast)
      const word = rankBits(s, rank, cast),
        disable = Math.fround(disableSq(rank)),
        reach = Math.fround(deformReach(rank))
      if (word === s.words[rank] && disable === s.disable[rank] && reach === s.reach[rank]) continue
      s.worldSpace += +((word & MOBILITY_WORLD_SPACE) !== 0) - +((was & MOBILITY_WORLD_SPACE) !== 0)
      s.words[rank] = word
      s.disable[rank] = disable
      s.reach[rank] = reach
      if (rank !== last + 1) {
        if (first >= 0) push(first, last - first + 1)
        first = rank
      }
      last = rank
    }
  }
  if (first >= 0) push(first, last - first + 1)
  s.changed.clear()
}
